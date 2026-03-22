import * as vscode from 'vscode';
import { KanbanTask, CopilotSessionInfo } from '../types/KanbanTask';
import { ColumnId } from '../types/ColumnId';
import { SquadStatus } from '../types/Messages';
import { ProviderRegistry } from '../providers/ProviderRegistry';
import { CopilotLauncher } from './CopilotLauncher';
import { ProjectConfig } from '../config/ProjectConfig';
import { Logger } from '../utils/logger';
import {
  DEFAULT_MAX_SESSIONS,
  DEFAULT_SOURCE_COLUMN,
  DEFAULT_ACTIVE_COLUMN,
  DEFAULT_DONE_COLUMN,
  DEFAULT_AUTO_SQUAD_INTERVAL,
  DEFAULT_MAX_RETRIES,
  computeAvailableSlots,
  canRetry,
  sortByPriority,
} from './squadUtils';

export {
  DEFAULT_MAX_SESSIONS,
  DEFAULT_SOURCE_COLUMN,
  DEFAULT_ACTIVE_COLUMN,
  DEFAULT_DONE_COLUMN,
  DEFAULT_AUTO_SQUAD_INTERVAL,
  DEFAULT_MAX_RETRIES,
  computeAvailableSlots,
  canRetry,
  sortByPriority,
} from './squadUtils';

/**
 * Manages "squad" sessions — parallel copilot launches across
 * multiple tasks.
 *
 * Column mapping is fully configurable via `squad.sourceColumn`,
 * `squad.activeColumn`, and `squad.doneColumn` in the project config
 * (or VS Code settings).
 *
 * Sends generic VS Code notifications on automatic task state changes
 * (controlled via `notifications.taskActive` / `notifications.taskDone`).
 *
 * Supports two modes:
 * - **Start Squad**: one-shot launch of up to `maxSessions` copilot sessions.
 * - **Auto Squad**: continuously monitors and launches new sessions as
 *   previous ones complete, toggled on/off.
 */
export class SquadManager {
  private activeSessions = new Map<string, CopilotSessionInfo>();
  /** Tracks retry attempts per task id. */
  private retryCount = new Map<string, number>();
  private autoSquadEnabled = false;
  private autoSquadTimer: ReturnType<typeof setInterval> | undefined;

  private readonly logger = Logger.getInstance();

  private readonly onStatusChangeEmitter = new vscode.EventEmitter<SquadStatus>();
  /** Fires whenever the squad status changes. */
  readonly onDidChangeStatus: vscode.Event<SquadStatus> = this.onStatusChangeEmitter.event;

  constructor(
    private readonly providerRegistry: ProviderRegistry,
    private readonly copilotLauncher: CopilotLauncher,
    private readonly genAiProviderId: () => string,
  ) {}

  // ── Public API ──────────────────────────────────────────────────────

  /** One-shot: launch copilot sessions for available tasks up to maxSessions. */
  async startSquad(): Promise<number> {
    const max = this.getMaxSessions();
    const available = max - this.activeSessions.size;
    if (available <= 0) {
      this.logger.info('SquadManager: no slots available (active=%d, max=%d)', this.activeSessions.size, max);
      return 0;
    }

    const tasks = await this.getEligibleTasks();
    const toRun = tasks.slice(0, available);

    this.logger.info('SquadManager: starting squad — %d tasks to launch', toRun.length);
    let launched = 0;
    for (const task of toRun) {
      await this.launchSession(task);
      launched++;
    }

    this.fireStatusChange();
    return launched;
  }

  /** Toggle auto-squad mode. Returns the new state. */
  toggleAutoSquad(): boolean {
    this.autoSquadEnabled = !this.autoSquadEnabled;

    if (this.autoSquadEnabled) {
      this.logger.info('SquadManager: auto-squad ENABLED');
      // Immediately try to fill slots, then poll
      void this.startSquad();
      const interval = this.getAutoSquadInterval();
      this.autoSquadTimer = setInterval(() => void this.startSquad(), interval);
    } else {
      this.logger.info('SquadManager: auto-squad DISABLED');
      if (this.autoSquadTimer) {
        clearInterval(this.autoSquadTimer);
        this.autoSquadTimer = undefined;
      }
    }

    this.fireStatusChange();
    return this.autoSquadEnabled;
  }

  /** Return the current squad status snapshot. */
  getStatus(): SquadStatus {
    return {
      activeCount: this.activeSessions.size,
      maxSessions: this.getMaxSessions(),
      autoSquadEnabled: this.autoSquadEnabled,
    };
  }

  /** Get session info for a specific task, if any. */
  getSessionInfo(taskId: string): CopilotSessionInfo | undefined {
    return this.activeSessions.get(taskId);
  }

  /** Mark a session as completed (called when the provider finishes). */
  completeSession(taskId: string): void {
    const session = this.activeSessions.get(taskId);
    if (session) {
      session.state = 'completed';
      session.finishedAt = new Date().toISOString();
      this.activeSessions.delete(taskId);
      this.fireStatusChange();
    }
  }

  /** Mark a session as failed. */
  failSession(taskId: string): void {
    const session = this.activeSessions.get(taskId);
    if (session) {
      session.state = 'failed';
      session.finishedAt = new Date().toISOString();
      this.activeSessions.delete(taskId);
      this.fireStatusChange();
    }
  }

  dispose(): void {
    if (this.autoSquadTimer) {
      clearInterval(this.autoSquadTimer);
      this.autoSquadTimer = undefined;
    }
    this.onStatusChangeEmitter.dispose();
  }

  // ── Internal ────────────────────────────────────────────────────────

  private getMaxSessions(): number {
    const projectCfg = ProjectConfig.getProjectConfig();
    return ProjectConfig.resolve(
      projectCfg?.squad?.maxSessions,
      'squad.maxSessions',
      DEFAULT_MAX_SESSIONS,
    );
  }

  private getSourceColumn(): ColumnId {
    const projectCfg = ProjectConfig.getProjectConfig();
    return ProjectConfig.resolve(
      projectCfg?.squad?.sourceColumn,
      'squad.sourceColumn',
      DEFAULT_SOURCE_COLUMN,
    ) as ColumnId;
  }

  private getActiveColumn(): ColumnId {
    const projectCfg = ProjectConfig.getProjectConfig();
    return ProjectConfig.resolve(
      projectCfg?.squad?.activeColumn,
      'squad.activeColumn',
      DEFAULT_ACTIVE_COLUMN,
    ) as ColumnId;
  }

  private getDoneColumn(): ColumnId {
    const projectCfg = ProjectConfig.getProjectConfig();
    return ProjectConfig.resolve(
      projectCfg?.squad?.doneColumn,
      'squad.doneColumn',
      DEFAULT_DONE_COLUMN,
    ) as ColumnId;
  }

  private async getEligibleTasks(): Promise<KanbanTask[]> {
    const sourceCol = this.getSourceColumn();
    const providers = this.providerRegistry.getAll();
    const allTasks = (
      await Promise.allSettled(providers.map(p => p.getTasks()))
    )
      .filter((r): r is PromiseFulfilledResult<KanbanTask[]> => r.status === 'fulfilled')
      .flatMap(r => r.value);

    // Only tasks in the configured source column that don't already have an active session
    const eligible = allTasks.filter(
      t => t.status === sourceCol && !this.activeSessions.has(t.id),
    );

    // Sort by label-based priority when configured
    const priorityLabels = this.getPriorityLabels();
    return sortByPriority(eligible, priorityLabels);
  }

  /** Move a task to the given column via its provider. */
  private async moveTask(task: KanbanTask, toColumn: ColumnId): Promise<void> {
    const [providerId] = task.id.split(':');
    const provider = this.providerRegistry.get(providerId);
    if (provider) {
      await provider.updateTask({ ...task, status: toColumn });
    }
  }

  /** Resolve whether a generic notification should be shown. */
  private shouldNotify(key: 'taskActive' | 'taskDone'): boolean {
    const projectCfg = ProjectConfig.getProjectConfig();
    return ProjectConfig.resolve(
      projectCfg?.notifications?.[key],
      `notifications.${key}`,
      true,
    );
  }

  private async launchSession(task: KanbanTask): Promise<void> {
    const providerId = this.genAiProviderId();
    const session: CopilotSessionInfo = {
      state: 'running',
      providerId,
      startedAt: new Date().toISOString(),
    };
    this.activeSessions.set(task.id, session);

    // Move task to "active" column (e.g. inprogress)
    const activeCol = this.getActiveColumn();
    await this.moveTask(task, activeCol);

    // Notify on automatic state change → active
    if (this.shouldNotify('taskActive')) {
      vscode.window.showInformationMessage(
        `Task "${task.title}" moved to ${activeCol}`,
      );
    }

    try {
      await this.copilotLauncher.launch(task.id, providerId);

      // Move task to "done" column (e.g. review)
      const doneCol = this.getDoneColumn();
      await this.moveTask(task, doneCol);

      // Notify on automatic state change → done
      if (this.shouldNotify('taskDone')) {
        vscode.window.showInformationMessage(
          `Task "${task.title}" moved to ${doneCol}`,
        );
      }

      this.completeSession(task.id);
    } catch {
      // Always notify on failure — failures are important regardless of config
      vscode.window.showErrorMessage(
        `Task "${task.title}" failed`,
      );
      this.failSession(task.id);

      // Auto-retry when configured
      const maxRetries = this.getMaxRetries();
      const attempt = this.retryCount.get(task.id) ?? 0;
      if (canRetry(attempt, maxRetries)) {
        this.retryCount.set(task.id, attempt + 1);
        this.logger.info(
          'SquadManager: retrying task "%s" (attempt %d/%d)',
          task.title,
          attempt + 1,
          maxRetries,
        );
        // Move back to source column so the next poll picks it up
        await this.moveTask(task, this.getSourceColumn());
      }
    }
  }

  private getAutoSquadInterval(): number {
    const projectCfg = ProjectConfig.getProjectConfig();
    return ProjectConfig.resolve(
      projectCfg?.squad?.autoSquadInterval,
      'squad.autoSquadInterval',
      DEFAULT_AUTO_SQUAD_INTERVAL,
    );
  }

  private getMaxRetries(): number {
    const projectCfg = ProjectConfig.getProjectConfig();
    return ProjectConfig.resolve(
      projectCfg?.squad?.maxRetries,
      'squad.maxRetries',
      DEFAULT_MAX_RETRIES,
    );
  }

  private getPriorityLabels(): string[] {
    const projectCfg = ProjectConfig.getProjectConfig();
    return ProjectConfig.resolve(
      projectCfg?.squad?.priorityLabels,
      'squad.priorityLabels',
      [] as string[],
    );
  }

  private fireStatusChange(): void {
    this.onStatusChangeEmitter.fire(this.getStatus());
  }
}

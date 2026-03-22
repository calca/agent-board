import * as vscode from 'vscode';
import { KanbanTask, CopilotSessionInfo } from '../types/KanbanTask';
import { SquadStatus } from '../types/Messages';
import { ProviderRegistry } from '../providers/ProviderRegistry';
import { CopilotLauncher } from './CopilotLauncher';
import { ProjectConfig } from '../config/ProjectConfig';
import { Logger } from '../utils/logger';
import { DEFAULT_MAX_SESSIONS, computeAvailableSlots } from './squadUtils';

export { DEFAULT_MAX_SESSIONS, computeAvailableSlots } from './squadUtils';

/**
 * Manages "squad" sessions — parallel copilot launches across
 * multiple tasks that are in the "todo" or "inprogress" columns.
 *
 * Supports two modes:
 * - **Start Squad**: one-shot launch of up to `maxSessions` copilot sessions.
 * - **Auto Squad**: continuously monitors and launches new sessions as
 *   previous ones complete, toggled on/off.
 */
export class SquadManager {
  private activeSessions = new Map<string, CopilotSessionInfo>();
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
      this.autoSquadTimer = setInterval(() => void this.startSquad(), 15_000);
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

  private async getEligibleTasks(): Promise<KanbanTask[]> {
    const providers = this.providerRegistry.getAll();
    const allTasks = (
      await Promise.allSettled(providers.map(p => p.getTasks()))
    )
      .filter((r): r is PromiseFulfilledResult<KanbanTask[]> => r.status === 'fulfilled')
      .flatMap(r => r.value);

    // Only tasks in "todo" that don't already have an active session
    return allTasks.filter(
      t => t.status === 'todo' && !this.activeSessions.has(t.id),
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

    try {
      await this.copilotLauncher.launch(task.id, providerId);
      this.completeSession(task.id);
    } catch {
      this.failSession(task.id);
    }
  }

  private fireStatusChange(): void {
    this.onStatusChangeEmitter.fire(this.getStatus());
  }
}

import * as vscode from 'vscode';
import { ProjectConfig } from '../config/ProjectConfig';
import { ProviderRegistry } from '../providers/ProviderRegistry';
import { ColumnId } from '../types/ColumnId';
import { CopilotSessionInfo, KanbanTask } from '../types/KanbanTask';
import { SquadStatus } from '../types/Messages';
import { Logger } from '../utils/logger';
import { CopilotLauncher } from './CopilotLauncher';
import { GenAiProviderRegistry } from './GenAiProviderRegistry';
import {
    SquadConfig,
    canRetry,
    resolveSquadConfig,
} from './squadUtils';

export {
    DEFAULT_ACTIVE_COLUMN, DEFAULT_AUTO_SQUAD_INTERVAL, DEFAULT_COOLDOWN_MS, DEFAULT_DONE_COLUMN, DEFAULT_MAX_RETRIES, DEFAULT_MAX_SESSIONS, DEFAULT_SESSION_TIMEOUT, DEFAULT_SOURCE_COLUMN, canRetry, computeAvailableSlots, resolveSquadConfig
} from './squadUtils';

export type { SquadConfig } from './squadUtils';

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
  /** Concurrency guard — prevents overlapping startSquad() calls. */
  private launching = false;
  /** Agent slug used during auto-squad polling. */
  private autoSquadAgentSlug: string | undefined;
  /** GenAI provider override used during auto-squad polling. */
  private autoSquadGenAiProviderId: string | undefined;

  private readonly logger = Logger.getInstance();

  private readonly onStatusChangeEmitter = new vscode.EventEmitter<SquadStatus>();
  /** Fires whenever the squad status changes. */
  readonly onDidChangeStatus: vscode.Event<SquadStatus> = this.onStatusChangeEmitter.event;

  private readonly onSessionCompletedEmitter = new vscode.EventEmitter<{ taskId: string; autoPR: boolean }>();
  /** Fires when a squad session completes successfully. */
  readonly onSessionCompleted: vscode.Event<{ taskId: string; autoPR: boolean }> = this.onSessionCompletedEmitter.event;

  constructor(
    private readonly providerRegistry: ProviderRegistry,
    private readonly copilotLauncher: CopilotLauncher,
    private readonly genAiProviderId: () => string,
    private readonly genAiRegistry?: GenAiProviderRegistry,
  ) {}

  // ── Public API ──────────────────────────────────────────────────────

  /** One-shot: launch copilot sessions for available tasks up to maxSessions. */
  async startSquad(agentSlug?: string, genAiProviderId?: string): Promise<number> {
    // Concurrency guard: skip if a launch cycle is already running
    if (this.launching) {
      this.logger.info('SquadManager: launch cycle already in progress — skipping');
      return 0;
    }
    this.launching = true;
    try {
      return await this.doStartSquad(agentSlug, genAiProviderId);
    } finally {
      this.launching = false;
    }
  }

  private async doStartSquad(agentSlug?: string, genAiProviderId?: string): Promise<number> {
    const cfg = this.getConfig();
    const available = cfg.maxSessions - this.activeSessions.size;
    if (available <= 0) {
      this.logger.info('SquadManager: no slots available (active=%d, max=%d)', this.activeSessions.size, cfg.maxSessions);
      return 0;
    }

    const tasks = await this.getEligibleTasks(cfg);
    const toRun = tasks.slice(0, available);

    this.logger.info('SquadManager: starting squad — %d tasks to launch', toRun.length);
    let launched = 0;
    for (const task of toRun) {
      // Apply cooldown between consecutive launches (skip before the first)
      if (launched > 0 && cfg.cooldownMs > 0) {
        await this.delay(cfg.cooldownMs);
      }
      // Fire-and-forget: register session and launch in background so all tasks start in parallel
      this.launchSessionInBackground(task, cfg, agentSlug, genAiProviderId);
      launched++;
    }

    this.fireStatusChange();
    return launched;
  }

  /** Toggle auto-squad mode. Returns the new state. */
  toggleAutoSquad(agentSlug?: string, genAiProviderId?: string): boolean {
    this.autoSquadEnabled = !this.autoSquadEnabled;

    if (this.autoSquadEnabled) {
      this.autoSquadAgentSlug = agentSlug;
      this.autoSquadGenAiProviderId = genAiProviderId;
      this.logger.info('SquadManager: auto-squad ENABLED');
      // Immediately try to fill slots, then poll
      void this.startSquad(agentSlug, genAiProviderId);
      const cfg = this.getConfig();
      this.autoSquadTimer = setInterval(() => void this.startSquad(this.autoSquadAgentSlug, this.autoSquadGenAiProviderId), cfg.autoSquadInterval);
    } else {
      this.autoSquadAgentSlug = undefined;
      this.autoSquadGenAiProviderId = undefined;
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
    const cfg = this.getConfig();
    return {
      activeCount: this.activeSessions.size,
      maxSessions: cfg.maxSessions,
      autoSquadEnabled: this.autoSquadEnabled,
    };
  }

  /**
   * Launch a single task as a tracked session (used by the CTA button).
   *
   * Registers the session and moves the task to the active column
   * **synchronously**, then runs the provider in the background.
   * When the provider completes the task moves to done; on failure
   * it moves back to the source column.
   *
   * Returns immediately after registration so the UI can refresh.
   */
  async launchSingle(taskId: string, genAiProviderId: string, agentSlug?: string): Promise<void> {
    const cfg = this.getConfig();

    // Resolve the task from its provider
    const resolved = await this.providerRegistry.resolveTask(taskId);
    if (!resolved) {
      this.logger.warn('SquadManager.launchSingle: task "%s" not found', taskId);
      return;
    }
    const { provider: taskProvider, task } = resolved;

    // Register the session
    const session: CopilotSessionInfo = {
      state: 'starting',
      providerId: genAiProviderId,
      startedAt: new Date().toISOString(),
    };
    this.activeSessions.set(taskId, session);
    this.fireStatusChange();

    // Persist the agent slug on the task so the UI can display it
    if (agentSlug && task.agent !== agentSlug) {
      try {
        await taskProvider.updateTask({ ...task, agent: agentSlug });
      } catch {
        // non-blocking — the launch proceeds regardless
      }
    }

    // Move to active column
    await this.moveTask(task, cfg.activeColumn);

    // Run the provider in the background (fire-and-forget)
    this.runInBackground(taskId, task, genAiProviderId, agentSlug, cfg);
  }

  /** Execute the provider in the background and update session state on completion. */
  private runInBackground(
    taskId: string,
    task: KanbanTask,
    providerId: string,
    agentSlug: string | undefined,
    cfg: SquadConfig,
  ): void {
    // Check whether this provider manages its own task progression
    const provider = this.genAiRegistry?.get(providerId);
    const autoAdvance = !provider?.disableAutoAdvance;

    // Transition to 'running' immediately
    const session = this.activeSessions.get(taskId);
    if (session) {
      session.state = 'running';
      this.fireStatusChange();
    }

    this.copilotLauncher.launch(taskId, providerId, agentSlug)
      .then(async () => {
        if (autoAdvance) {
          await this.moveTask(task, cfg.doneColumn);
        }
        this.completeSession(taskId);
        this.logger.info('SquadManager: session %s for "%s"', autoAdvance ? 'completed' : 'opened', task.title);
      })
      .catch(async () => {
        if (autoAdvance) {
          await this.moveTask(task, cfg.sourceColumn);
        }
        this.failSession(taskId);
        this.logger.error('SquadManager: session failed for "%s"', task.title);
      });
  }

  /** Get session info for a specific task, if any. */
  getSessionInfo(taskId: string): CopilotSessionInfo | undefined {
    return this.activeSessions.get(taskId);
  }

  /** Return a snapshot of all active sessions (taskId → session info). */
  getActiveSessions(): ReadonlyMap<string, CopilotSessionInfo> {
    return this.activeSessions;
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
      session.state = 'error';
      session.finishedAt = new Date().toISOString();
      this.activeSessions.delete(taskId);
      this.fireStatusChange();
    }
  }

  /**
   * Restore a session that was interrupted by a VS Code restart.
   * The card will show the `interrupted` state without re-launching.
   */
  restoreInterruptedSession(taskId: string, info: CopilotSessionInfo): void {
    this.activeSessions.set(taskId, info);
    this.fireStatusChange();
  }

  dispose(): void {
    if (this.autoSquadTimer) {
      clearInterval(this.autoSquadTimer);
      this.autoSquadTimer = undefined;
    }

    // Graceful shutdown: move in-progress tasks back to the source column
    // so they aren't stuck in the active column after the extension stops.
    if (this.activeSessions.size > 0) {
      const cfg = this.getConfig();
      this.logger.info(
        'SquadManager: graceful shutdown — moving %d active tasks back to %s',
        this.activeSessions.size,
        cfg.sourceColumn,
      );
      for (const [taskId, session] of this.activeSessions) {
        session.state = 'error';
        session.finishedAt = new Date().toISOString();
        // Best-effort: move task back (fire-and-forget — we're shutting down).
        void this.providerRegistry.resolveTask(taskId).then(resolved => {
          if (resolved) {
            void resolved.provider.updateTask({ ...resolved.task, status: cfg.sourceColumn });
          }
        });
      }
      this.activeSessions.clear();
    }

    this.onStatusChangeEmitter.dispose();
  }

  // ── Internal ────────────────────────────────────────────────────────

  /**
   * Read config once and resolve all squad + notification settings.
   *
   * This replaces the previous pattern of 8+ individual getter methods
   * that each performed a separate disk read via `getProjectConfig()`.
   */
  private getConfig(): SquadConfig {
    const projectCfg = ProjectConfig.getProjectConfig();
    return resolveSquadConfig(projectCfg?.squad, projectCfg?.notifications);
  }

  private async getEligibleTasks(cfg: SquadConfig): Promise<KanbanTask[]> {
    const providers = this.providerRegistry.getAll();
    const allTasks = (
      await Promise.allSettled(providers.map(p => p.getTasks()))
    )
      .filter((r): r is PromiseFulfilledResult<KanbanTask[]> => r.status === 'fulfilled')
      .flatMap(r => r.value);

    // Only tasks in the configured source column that don't already have an active session
    const eligible = allTasks.filter(
      t =>
        t.status === cfg.sourceColumn &&
        !this.activeSessions.has(t.id),
    );

    return eligible;
  }

  /** Move a task to the given column via its provider. */
  private async moveTask(task: KanbanTask, toColumn: ColumnId): Promise<void> {
    const provider = this.providerRegistry.get(task.providerId);
    if (provider) {
      await provider.updateTask({ ...task, status: toColumn });
    }
  }

  /**
   * Register the session synchronously and launch the provider in the background.
   * This allows multiple squad tasks to start in parallel.
   */
  private launchSessionInBackground(task: KanbanTask, cfg: SquadConfig, agentSlug?: string, genAiProviderId?: string): void {
    const providerId = genAiProviderId ?? this.genAiProviderId();
    const session: CopilotSessionInfo = {
      state: 'starting',
      providerId,
      startedAt: new Date().toISOString(),
    };
    this.activeSessions.set(task.id, session);
    this.fireStatusChange();

    // Move to active column, then launch (all async, fire-and-forget)
    void this.moveTask(task, cfg.activeColumn).then(() => {
      if (cfg.notifyTaskActive) {
        vscode.window.showInformationMessage(`Task "${task.title}" moved to ${cfg.activeColumn}`);
      }
      session.state = 'running';
      this.fireStatusChange();

      const launchPromise = this.copilotLauncher.launch(task.id, providerId, agentSlug);

      const runPromise = cfg.sessionTimeout > 0
        ? this.raceWithTimeout(launchPromise, task.id, cfg.sessionTimeout)
        : launchPromise;

      return runPromise
        .then(async () => {
          await this.moveTask(task, cfg.doneColumn);
          if (cfg.notifyTaskDone) {
            vscode.window.showInformationMessage(`Task "${task.title}" moved to ${cfg.doneColumn}`);
          }
          this.completeSession(task.id);
        })
        .catch(async () => {
          vscode.window.showErrorMessage(`Task "${task.title}" failed`);
          this.failSession(task.id);
          const attempt = this.retryCount.get(task.id) ?? 0;
          if (canRetry(attempt, cfg.maxRetries)) {
            this.retryCount.set(task.id, attempt + 1);
            this.logger.info('SquadManager: retrying task "%s" (attempt %d/%d)', task.title, attempt + 1, cfg.maxRetries);
            await this.moveTask(task, cfg.sourceColumn);
          }
        });
    });
  }

  /** Race a promise against a timeout, cancelling the session on timeout. */
  private async raceWithTimeout(promise: Promise<void>, taskId: string, timeoutMs: number): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Session timed out')), timeoutMs);
    });
    try {
      await Promise.race([promise, timeoutPromise]);
    } catch (err) {
      this.copilotLauncher.cancelSession(taskId);
      throw err;
    } finally {
      if (timer !== undefined) { clearTimeout(timer); }
    }
  }

  private async launchSession(task: KanbanTask, cfg: SquadConfig, agentSlug?: string, genAiProviderId?: string): Promise<void> {
    const providerId = genAiProviderId ?? this.genAiProviderId();
    const session: CopilotSessionInfo = {
      state: 'starting',
      providerId,
      startedAt: new Date().toISOString(),
    };
    this.activeSessions.set(task.id, session);
    this.fireStatusChange();

    // Move task to "active" column (e.g. inprogress)
    await this.moveTask(task, cfg.activeColumn);

    // Notify on automatic state change → active
    if (cfg.notifyTaskActive) {
      vscode.window.showInformationMessage(
        `Task "${task.title}" moved to ${cfg.activeColumn}`,
      );
    }

    try {
      // Transition to 'running' once the provider actually starts
      session.state = 'running';
      this.fireStatusChange();

      const launchPromise = this.copilotLauncher.launch(task.id, providerId, agentSlug);

      // Race the launch against the timeout (if configured)
      if (cfg.sessionTimeout > 0) {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const timeoutPromise = new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('Session timed out')), cfg.sessionTimeout);
        });
        try {
          await Promise.race([launchPromise, timeoutPromise]);
        } catch (err) {
          // Auto-kill the provider on timeout
          this.copilotLauncher.cancelSession(task.id);
          throw err;
        } finally {
          if (timer !== undefined) {
            clearTimeout(timer);
          }
        }
      } else {
        await launchPromise;
      }

      // Move task to "done" column (e.g. review)
      await this.moveTask(task, cfg.doneColumn);

      // Notify on automatic state change → done
      if (cfg.notifyTaskDone) {
        vscode.window.showInformationMessage(
          `Task "${task.title}" moved to ${cfg.doneColumn}`,
        );
      }

      this.completeSession(task.id);

      // Fire auto-PR event when configured
      this.onSessionCompletedEmitter.fire({ taskId: task.id, autoPR: cfg.autoPR });
    } catch {
      // Always notify on failure — failures are important regardless of config
      vscode.window.showErrorMessage(
        `Task "${task.title}" failed`,
      );
      this.failSession(task.id);

      // Auto-retry when configured
      const attempt = this.retryCount.get(task.id) ?? 0;
      if (canRetry(attempt, cfg.maxRetries)) {
        this.retryCount.set(task.id, attempt + 1);
        this.logger.info(
          'SquadManager: retrying task "%s" (attempt %d/%d)',
          task.title,
          attempt + 1,
          cfg.maxRetries,
        );
        // Move back to source column so the next poll picks it up
        await this.moveTask(task, cfg.sourceColumn);
      }
    }
  }

  /** Simple async delay (injectable via subclass for testing). */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private fireStatusChange(): void {
    this.onStatusChangeEmitter.fire(this.getStatus());
  }
}

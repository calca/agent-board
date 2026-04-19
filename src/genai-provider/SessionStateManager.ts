import * as vscode from 'vscode';
import { Logger } from '../utils/logger';
import {
    fixInterruptedSessions,
    PersistedSession,
    SessionState,
    toCopilotSessionInfo as toCopilotInfo,
} from './sessionStateUtils';

// Re-export pure utilities so consumers can import from one place
export {
    badgeColor,
    badgeIcon,
    fixInterruptedSessions,
    isActive,
    mapStateToCopilot,
    toCopilotSessionInfo
} from './sessionStateUtils';
export type { PersistedSession, SessionState } from './sessionStateUtils';

const STATE_KEY = 'agentBoard.sessions';

/** Default timeout: 5 minutes. */
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Manages the full lifecycle of agent sessions with extended states,
 * configurable timeouts, and persistence across VS Code restarts.
 *
 * States: `idle → starting → running → paused → completed | error`
 *
 * Features:
 * - Badge color mapping for each state
 * - Configurable timeout with auto-kill
 * - Session persistence/resume via `workspaceState`
 * - Cleanup of interrupted sessions on activation
 */
export class SessionStateManager {
  private readonly logger = Logger.getInstance();
  private sessions = new Map<string, PersistedSession>();
  private timers = new Map<string, ReturnType<typeof setTimeout>>();

  private readonly onStateChangeEmitter = new vscode.EventEmitter<{
    taskId: string;
    state: SessionState;
    previous: SessionState;
  }>();
  /** Fires whenever a session state changes. */
  readonly onDidChangeState = this.onStateChangeEmitter.event;

  constructor(private readonly context: vscode.ExtensionContext) {
    this.restoreSessions();
  }

  // ── Public API ──────────────────────────────────────────────────────

  /** Register a new session in `starting` state. */
  startSession(taskId: string, providerId: string, worktreePath?: string, logPath?: string, baseBranch?: string): void {
    const session: PersistedSession = {
      taskId,
      state: 'starting',
      providerId,
      worktreePath,
      logPath,
      baseBranch,
      startedAt: new Date().toISOString(),
    };
    this.sessions.set(taskId, session);
    this.persist();
    this.fireChange(taskId, 'starting', 'idle');
  }

  /** Update the log file path for an existing session. */
  setLogPath(taskId: string, logPath: string): void {
    const session = this.sessions.get(taskId);
    if (!session) { return; }
    session.logPath = logPath;
    this.persist();
  }

  /** Transition a session to `running` and arm the timeout. */
  markRunning(taskId: string): void {
    const session = this.sessions.get(taskId);
    if (!session) { return; }
    const prev = session.state;
    session.state = 'running';
    this.persist();
    this.armTimeout(taskId);
    this.fireChange(taskId, 'running', prev);
  }

  /**
   * Transition a session to `manual`.
   *
   * Used for providers whose `disableAutoAdvance` is `true` — the task
   * is in-progress but all further state changes are user-driven.
   * No timeout is armed because there is nothing to time-out.
   */
  markManual(taskId: string): void {
    const session = this.sessions.get(taskId);
    if (!session) { return; }
    const prev = session.state;
    session.state = 'manual';
    this.clearTimer(taskId);
    this.persist();
    this.fireChange(taskId, 'manual', prev);
  }

  /** Pause a running session (e.g. user requested pause). */
  markPaused(taskId: string): void {
    const session = this.sessions.get(taskId);
    if (!session || session.state !== 'running') { return; }
    session.state = 'paused';
    this.clearTimer(taskId);
    this.persist();
    this.fireChange(taskId, 'paused', 'running');
  }

  /** Resume a paused session. */
  resume(taskId: string): void {
    const session = this.sessions.get(taskId);
    if (!session || session.state !== 'paused') { return; }
    session.state = 'running';
    this.armTimeout(taskId);
    this.persist();
    this.fireChange(taskId, 'running', 'paused');
  }

  /** Mark a session as successfully completed. */
  markCompleted(taskId: string): void {
    const session = this.sessions.get(taskId);
    if (!session) { return; }
    const prev = session.state;
    session.state = 'completed';
    session.finishedAt = new Date().toISOString();
    this.clearTimer(taskId);
    this.persist();
    this.fireChange(taskId, 'completed', prev);
  }

  /** Mark a session as failed/errored. */
  markError(taskId: string, errorMessage?: string): void {
    const session = this.sessions.get(taskId);
    if (!session) { return; }
    const prev = session.state;
    session.state = 'error';
    session.errorMessage = errorMessage;
    session.finishedAt = new Date().toISOString();
    this.clearTimer(taskId);
    this.persist();
    this.fireChange(taskId, 'error', prev);
  }

  /** Remove a session entirely (after worktree cleanup). */
  removeSession(taskId: string): void {
    this.sessions.delete(taskId);
    this.clearTimer(taskId);
    this.persist();
  }

  /** Mark a session as merged (worktree branch merged locally). */
  markMerged(taskId: string): void {
    const session = this.sessions.get(taskId);
    if (!session) { return; }
    session.merged = true;
    this.persist();
  }

  /** Store the Copilot CLI session ID for future resume. */
  setCliSessionId(taskId: string, cliSessionId: string): void {
    const session = this.sessions.get(taskId);
    if (!session) { return; }
    session.cliSessionId = cliSessionId;
    this.persist();
  }

  /** Clear the worktree path from a session (after worktree deletion) while keeping all other info. */
  clearWorktree(taskId: string): void {
    const session = this.sessions.get(taskId);
    if (!session) { return; }
    session.worktreePath = undefined;
    this.persist();
    this.fireChange(taskId, session.state, session.state);
  }

  /** Get a session by task ID. */
  getSession(taskId: string): PersistedSession | undefined {
    return this.sessions.get(taskId);
  }

  /** Get all active sessions (not done/error/interrupted). */
  getActiveSessions(): PersistedSession[] {
    return [...this.sessions.values()].filter(
      s => s.state === 'starting' || s.state === 'running' || s.state === 'paused',
    );
  }

  /** Get sessions that were interrupted by a VS Code restart. */
  getInterruptedSessions(): PersistedSession[] {
    return [...this.sessions.values()].filter(s => s.state === 'interrupted');
  }

  /** Get all sessions (including completed/errored). */
  getAllSessions(): ReadonlyMap<string, PersistedSession> {
    return this.sessions;
  }

  /** Convert a session state to `CopilotSessionInfo` for the WebView. */
  toCopilotSessionInfo(session: PersistedSession) {
    return toCopilotInfo(session);
  }

  dispose(): void {
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
    this.onStateChangeEmitter.dispose();
  }

  /**
   * Reset the inactivity timeout for a running session.
   * Call this whenever the session produces output so that active
   * sessions are not incorrectly marked as timed-out.
   */
  resetTimeout(taskId: string): void {
    const session = this.sessions.get(taskId);
    if (session && session.state === 'running' && this.timers.has(taskId)) {
      this.armTimeout(taskId);
    }
  }

  // ── Persistence ─────────────────────────────────────────────────────

  private persist(): void {
    const data: PersistedSession[] = [...this.sessions.values()];
    this.context.workspaceState.update(STATE_KEY, data);
  }

  /**
   * Restore sessions from `workspaceState` on activation.
   * Any session that was `starting` or `running` is marked as `error`
   * (interrupted by VS Code restart). Sessions are **not** restarted
   * automatically for safety.
   */
  private restoreSessions(): void {
    const saved = this.context.workspaceState.get<PersistedSession[]>(STATE_KEY, []);
    const fixed = fixInterruptedSessions(saved);
    for (const s of fixed) {
      if (s.state === 'interrupted' && saved.find(o => o.taskId === s.taskId)?.state !== 'interrupted') {
        this.logger.warn(
          'SessionStateManager: session "%s" was interrupted — restoring with interrupted state',
          s.taskId,
        );
      }
      this.sessions.set(s.taskId, s);
    }
    if (saved.length > 0) {
      this.persist();
    }
  }

  // ── Timeout ─────────────────────────────────────────────────────────

  private getTimeoutMs(): number {
    const setting = vscode.workspace
      .getConfiguration('agentBoard')
      .get<number>('sessionTimeoutMinutes');
    if (typeof setting === 'number' && setting > 0) {
      return setting * 60 * 1000;
    }
    return DEFAULT_TIMEOUT_MS;
  }

  private armTimeout(taskId: string): void {
    this.clearTimer(taskId);
    const ms = this.getTimeoutMs();
    if (ms <= 0) { return; }

    const timer = setTimeout(() => {
      const session = this.sessions.get(taskId);
      if (session && session.state === 'running') {
        this.logger.warn('SessionStateManager: session "%s" timed out after %dms', taskId, ms);
        this.markError(taskId);
        vscode.window.showWarningMessage(
          `Agent session for "${taskId}" timed out after ${Math.round(ms / 60000)} minutes.`,
        );
      }
    }, ms);

    this.timers.set(taskId, timer);
  }

  private clearTimer(taskId: string): void {
    const existing = this.timers.get(taskId);
    if (existing) {
      clearTimeout(existing);
      this.timers.delete(taskId);
    }
  }

  // ── Helpers ─────────────────────────────────────────────────────────

  private fireChange(taskId: string, state: SessionState, previous: SessionState): void {
    this.logger.info('SessionStateManager: "%s" %s → %s', taskId, previous, state);
    this.onStateChangeEmitter.fire({ taskId, state, previous });
  }
}

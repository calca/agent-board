import { CopilotSessionInfo, CopilotSessionState } from '../types/KanbanTask';

/**
 * Extended session state that includes `starting` and `paused`
 * beyond the existing `CopilotSessionState`.
 */
export type SessionState = 'idle' | 'starting' | 'running' | 'paused' | 'done' | 'error' | 'interrupted';

/** Persisted session record stored in `workspaceState`. */
export interface PersistedSession {
  taskId: string;
  worktreePath?: string;
  state: SessionState;
  providerId: string;
  startedAt?: string;
  finishedAt?: string;
  logPath?: string;
  /** Human-readable error message when state is 'error'. */
  errorMessage?: string;
}

// ── Pure utilities (testable without VS Code) ─────────────────────────

/** Map `SessionState` → codicon badge colour for the WebView card. */
export function badgeColor(state: SessionState): string {
  switch (state) {
    case 'idle': return 'editorWidget.foreground';
    case 'starting': return 'charts.yellow';
    case 'running': return 'charts.green';
    case 'paused': return 'charts.orange';
    case 'done': return 'charts.blue';
    case 'error': return 'charts.red';
    case 'interrupted': return 'charts.orange';
  }
}

/** Map `SessionState` → codicon name for status display. */
export function badgeIcon(state: SessionState): string {
  switch (state) {
    case 'idle': return 'circle-outline';
    case 'starting': return 'loading~spin';
    case 'running': return 'play-circle';
    case 'paused': return 'debug-pause';
    case 'done': return 'check';
    case 'error': return 'error';
    case 'interrupted': return 'warning';
  }
}

/** Map extended SessionState to CopilotSessionState (backward compat). */
export function mapStateToCopilot(state: SessionState): CopilotSessionState {
  switch (state) {
    case 'idle': return 'idle';
    case 'starting':
    case 'running':
    case 'paused':
      return 'running';
    case 'done': return 'done';
    case 'error': return 'error';
    case 'interrupted': return 'interrupted';
  }
}

/** Convert a session to `CopilotSessionInfo` for the WebView. */
export function toCopilotSessionInfo(session: PersistedSession): CopilotSessionInfo {
  return {
    state: mapStateToCopilot(session.state),
    providerId: session.providerId,
    startedAt: session.startedAt,
    finishedAt: session.finishedAt,
    worktreePath: session.worktreePath,
    errorMessage: session.errorMessage,
  };
}

/** Return true if the state means "active" (starting / running / paused). */
export function isActive(state: SessionState): boolean {
  return state === 'starting' || state === 'running' || state === 'paused';
}

/**
 * Fix interrupted sessions: anything `starting`, `running`, or `paused`
 * from a previous VS Code lifecycle is moved to `interrupted`.
 * Sessions that were already `interrupted`, `done`, or `error` are left as-is.
 */
export function fixInterruptedSessions(sessions: PersistedSession[]): PersistedSession[] {
  return sessions.map(s => {
    if (s.state === 'starting' || s.state === 'running' || s.state === 'paused') {
      return { ...s, state: 'interrupted' as SessionState, finishedAt: new Date().toISOString() };
    }
    return s;
  });
}

import { ColumnId } from './ColumnId';

/** Current state of a copilot session attached to a task. */
export type CopilotSessionState = 'idle' | 'running' | 'completed' | 'failed';

/** Provider-supplied links/shortcuts for an active copilot session. */
export interface CopilotSessionInfo {
  /** Current session state. */
  state: CopilotSessionState;
  /** GenAI provider id that is running this session. */
  providerId?: string;
  /** URL to open the VS Code session (e.g. vscode://…). */
  sessionUrl?: string;
  /** URL to open the cloud dashboard for this session. */
  cloudUrl?: string;
  /** Timestamp when the session started. */
  startedAt?: string;
  /** Timestamp when the session finished. */
  finishedAt?: string;
  /** Pull request URL (set after PR creation). */
  prUrl?: string;
  /** Pull request number. */
  prNumber?: number;
  /** Pull request state. */
  prState?: 'open' | 'closed' | 'merged';
  /** Files changed during the session. */
  changedFiles?: string[];
}

/**
 * Normalised task representation shared across all providers.
 * The `id` field uses the format `{providerId}:{nativeId}`.
 */
export interface KanbanTask {
  id: string;
  title: string;
  body: string;
  status: ColumnId;
  labels: string[];
  assignee?: string;
  url?: string;
  providerId: string;
  createdAt?: Date;
  meta: Record<string, unknown>;
  /** Copilot session info, present when a copilot session is attached. */
  copilotSession?: CopilotSessionInfo;
}

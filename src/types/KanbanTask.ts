import { ColumnId } from './ColumnId';

/** Current state of a copilot session attached to a task. */
export type CopilotSessionState = 'idle' | 'starting' | 'running' | 'paused' | 'completed' | 'error' | 'interrupted' | 'manual';

/** Provider-supplied links/shortcuts for an active copilot session. */
export interface CopilotSessionInfo {
  /** Current session state. */
  state: CopilotSessionState;
  /** GenAI provider id that is running this session. */
  providerId?: string;
  /** URL to open the VS Code session (e.g. vscode://…). */
  sessionUrl?: string;
  /** URL to open the cloud dashboard for this session. */
  githubCloudUrl?: string;
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
  /** Relative path to the worktree directory (if created). */
  worktreePath?: string;
  /** Human-readable error message (set when state is 'error'). */
  errorMessage?: string;
  /** Whether the worktree branch has been merged locally. */
  merged?: boolean;
}

/**
 * Normalised task representation shared across all providers.
 * The `id` field uses the format `{providerId}:{nativeId}`.
 */
export interface KanbanTask {
  id: string;
  /** The provider-local identifier (without the provider prefix). */
  nativeId: string;
  title: string;
  body: string;
  status: ColumnId;
  labels: string[];
  assignee?: string;
  url?: string;
  providerId: string;
  createdAt?: Date;
  meta: Record<string, unknown>;
  /** Slug of the agent used to launch the last session, if any. */
  agent?: string;
  /** Slug of the squad agent assigned to this specific task. */
  squadAgent?: string;
  /** Copilot session info, present when a copilot session is attached. */
  copilotSession?: CopilotSessionInfo;
}


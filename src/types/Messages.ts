import { ColumnId } from './ColumnId';
import { KanbanTask } from './KanbanTask';

// ── Shared payload types ─────────────────────────────────────────────────────

/** A single file change reported by the DiffWatcher. */
export interface FileChangeInfo {
  path: string;
  status: 'added' | 'modified' | 'deleted';
}

// ── Host → WebView ──────────────────────────────────────────────────────────

export interface Column {
  id: ColumnId;
  label: string;
}

/** Snapshot of the squad manager state sent to the WebView. */
export interface SquadStatus {
  /** Number of copilot sessions currently running. */
  activeCount: number;
  /** Maximum parallel sessions allowed. */
  maxSessions: number;
  /** Whether auto-squad mode is enabled. */
  autoSquadEnabled: boolean;
}

/** Minimal agent info sent to the WebView for the agent picker. */
export interface AgentOption {
  slug: string;
  displayName: string;
}

/** Minimal GenAI provider info sent to the WebView. */
export interface GenAiProviderOption {
  id: string;
  displayName: string;
  icon: string;
  /** When true the provider button is shown but greyed-out / non-clickable. */
  disabled?: boolean;
  /** Short reason shown as tooltip when the button is disabled. */
  disabledReason?: string;
}

export type HostToWebView =
  | { type: 'tasksUpdate'; tasks: KanbanTask[]; columns: Column[]; editableProviderIds: string[]; genAiProviders: GenAiProviderOption[] }
  | { type: 'providerStatus'; providerId: string; status: 'ok' | 'error' | 'loading'; message?: string }
  | { type: 'themeChange'; kind: 'dark' | 'light' | 'hc' }
  | { type: 'squadStatus'; status: SquadStatus }
  | { type: 'agentsAvailable'; agents: AgentOption[] }
  | { type: 'mcpStatus'; enabled: boolean }
  | { type: 'showTaskForm'; columns: Column[] }
  | { type: 'streamOutput'; sessionId: string; text: string }
  | { type: 'fileChanges'; sessionId: string; files: FileChangeInfo[] }
  | { type: 'repoStatus'; isGit: boolean; isGitHub: boolean };

// ── WebView → Host ──────────────────────────────────────────────────────────

/** Data sent from the task‑creation form in the side panel. */
export interface NewTaskData {
  title: string;
  body: string;
  status: ColumnId;
  labels: string;
  assignee: string;
}

export type WebViewToHost =
  | { type: 'taskMoved'; taskId: string; toCol: ColumnId; index: number }
  | { type: 'openCopilot'; taskId: string; providerId: string; agentSlug?: string }
  | { type: 'cancelSession'; taskId: string }
  | { type: 'refreshRequest'; providerId?: string }
  | { type: 'ready' }
  | { type: 'addTask' }
  | { type: 'saveTask'; data: NewTaskData }
  | { type: 'editTask'; taskId: string; data: NewTaskData }
  | { type: 'launchProvider'; taskId: string; genAiProviderId: string }
  | { type: 'reopenSession'; taskId: string }
  | { type: 'cancelTaskForm' }
  | { type: 'startSquad'; agentSlug?: string; genAiProviderId?: string }
  | { type: 'toggleAutoSquad'; agentSlug?: string; genAiProviderId?: string }
  | { type: 'toggleMcp' }
  | { type: 'openDiff'; filePath: string }
  | { type: 'openFullDiff' }
  | { type: 'exportLog'; sessionId: string }
  | { type: 'sendFollowUp'; sessionId: string; text: string };

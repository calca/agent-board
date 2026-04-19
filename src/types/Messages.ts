import { ColumnId } from './ColumnId';
import { KanbanTask } from './KanbanTask';

// ── Shared payload types ─────────────────────────────────────────────────────

/** A single file change reported by the DiffWatcher. */
export interface FileChangeInfo {
  path: string;
  status: 'added' | 'modified' | 'deleted';
}

export interface MobileDeviceInfo {
  ip: string;
  lastAccess: string;
}

// ── Host → WebView ──────────────────────────────────────────────────────────

export interface Column {
  id: ColumnId;
  label: string;
  /** Optional background colour (hex). Applied with transparency in the webview. */
  color?: string;
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
  /** Whether this agent supports squad mode. */
  canSquad?: boolean;
}

/** Minimal GenAI provider info sent to the WebView. */
export interface GenAiProviderOption {
  id: string;
  displayName: string;
  icon: string;
  /** When true the provider can participate in squad sessions. Defaults to true. */
  canSquad?: boolean;
  /** When true the provider button is shown but greyed-out / non-clickable. */
  disabled?: boolean;
  /** Short reason shown as tooltip when the button is disabled. */
  disabledReason?: string;
}

/** Setting descriptor for a single GenAI provider config field (host → settings webview). */
export interface GenAiSettingDescriptorMsg {
  key: string;
  title: string;
  description: string;
  type: 'boolean' | 'string' | 'number' | 'select';
  defaultValue: string | number | boolean;
  options?: Array<{ label: string; value: string | number | boolean }>;
}

/** Full GenAI provider metadata sent to the settings webview. */
export interface GenAiProviderInfo {
  id: string;
  displayName: string;
  icon: string;
  description: string;
  settings: GenAiSettingDescriptorMsg[];
}

/** UI block shape for chat block messages (mirrors copilot-sdk/types.ts UIBlock). */
export type UIBlockMsg =
  | { type: 'text'; content: string; streaming?: boolean }
  | { type: 'code'; content: string; language?: string }
  | { type: 'command'; content: string }
  | { type: 'result'; content: string }
  | { type: 'step'; label: string; status?: 'running' | 'done' };

export type HostToWebView =
  | { type: 'tasksUpdate'; tasks: KanbanTask[]; columns: Column[]; editableProviderIds: string[]; genAiProviders: GenAiProviderOption[] }
  | { type: 'providerStatus'; providerId: string; status: 'ok' | 'error' | 'loading'; message?: string }
  | { type: 'themeChange'; kind: 'dark' | 'light' | 'hc' }
  | { type: 'squadStatus'; status: SquadStatus }
  | { type: 'agentsAvailable'; agents: AgentOption[] }
  | { type: 'branchesAvailable'; branches: string[]; current: string }
  | { type: 'mcpStatus'; enabled: boolean }
  | { type: 'showTaskForm'; columns: Column[]; currentUser?: string }
  | { type: 'streamOutput'; sessionId: string; text: string; ts: string; role?: 'user' | 'assistant' | 'tool' }
  | { type: 'streamResume'; sessionId: string; log: string }
  | { type: 'toolCall'; sessionId: string; status: string }
  | { type: 'fileChanges'; sessionId: string; files: FileChangeInfo[] }
  | { type: 'repoStatus'; isGit: boolean; isGitHub: boolean; isAzureDevOps?: boolean; workspaceRoot?: string; workspaceName?: string }
  | { type: 'mobileStatus'; running: boolean; url: string; devices: MobileDeviceInfo[]; qrSvg?: string; tunnelEnabled?: boolean; tunnelActive?: boolean; tunnelUrl?: string; refreshing?: boolean }
  | { type: 'mobileDialog'; open: boolean }
  | { type: 'mergeResult'; sessionId: string; success: boolean; message: string }
  | { type: 'deleteWorktreeResult'; sessionId: string; success: boolean; message?: string }
  | { type: 'createPullRequestResult'; sessionId: string; success: boolean; prUrl?: string; prNumber?: number; message?: string }
  | { type: 'agentLog'; taskId: string; chunk: string; done: boolean }
  | { type: 'agentError'; taskId: string; error: string }
  | { type: 'localNotes'; taskId: string; notes: string }
  | { type: 'chatBlock'; sessionId: string; block: UIBlockMsg }
  | { type: 'chatStart'; sessionId: string }
  | { type: 'chatEnd'; sessionId: string }
  | { type: 'chatError'; sessionId: string; content: string };

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
  | { type: 'taskMoved'; taskId: string; providerId: string; toCol: ColumnId; index: number }
  | { type: 'openCopilot'; taskId: string; providerId: string; agentSlug?: string; baseBranch?: string }
  | { type: 'cancelSession'; taskId: string }
  | { type: 'resetSession'; sessionId: string }
  | { type: 'refreshRequest'; providerId?: string }
  | { type: 'ready' }
  | { type: 'addTask' }
  | { type: 'saveTask'; data: NewTaskData }
  | { type: 'editTask'; taskId: string; providerId: string; data: NewTaskData }
  | { type: 'launchProvider'; taskId: string; providerId: string; genAiProviderId: string; baseBranch?: string }
  | { type: 'reopenSession'; taskId: string }
  | { type: 'cancelTaskForm' }
  | { type: 'openWorktree'; worktreePath: string }
  | { type: 'startSquad'; agentSlug?: string; genAiProviderId?: string; baseBranch?: string }
  | { type: 'toggleAutoSquad'; agentSlug?: string; genAiProviderId?: string; baseBranch?: string }
  | { type: 'toggleMcp' }
  | { type: 'toggleMobileServer' }
  | { type: 'setMobileTunnelEnabled'; enabled: boolean }
  | { type: 'refreshMobileStatus' }
  | { type: 'openMobileCompanion' }
  | { type: 'openDiff'; sessionId: string; filePath: string }
  | { type: 'openFullDiff'; sessionId: string }
  | { type: 'openTerminalInWorktree'; sessionId: string }
  | { type: 'exportLog'; sessionId: string }
  | { type: 'requestStreamResume'; sessionId: string }
  | { type: 'requestFileChanges'; sessionId: string }
  | { type: 'sendFollowUp'; sessionId: string; text: string }
  | { type: 'reviewWorktree'; sessionId: string }
  | { type: 'mergeWorktree'; sessionId: string; mergeStrategy: 'squash' | 'merge' | 'rebase' }
  | { type: 'agentMerge'; sessionId: string; mergeStrategy: 'squash' | 'merge' | 'rebase'; providerId: string }
  | { type: 'alignWorktree'; sessionId: string }
  | { type: 'deleteWorktree'; sessionId: string }
  | { type: 'deleteTask'; taskId: string; providerId: string }
  | { type: 'hideTask'; taskId: string }
  | { type: 'createPullRequest'; sessionId: string }
  | { type: 'exportDoneMd' }
  | { type: 'cleanDone' }
  | { type: 'startAgent'; taskId: string; provider: string; prompt: string }
  | { type: 'cancelAgent'; taskId: string }
  | { type: 'saveLocalNotes'; taskId: string; providerId: string; notes: string };

/**
 * Shared types for the webview, mirroring the host-side Messages.ts types.
 * Kept here so React components can import without depending on the extension source.
 */

export interface Column { id: string; label: string; color?: string }

export interface CopilotSession {
  state: 'idle' | 'starting' | 'running' | 'paused' | 'completed' | 'error' | 'interrupted';
  providerId?: string;
  startedAt?: string;
  finishedAt?: string;
  prUrl?: string;
  prNumber?: number;
  prState?: 'open' | 'merged' | 'closed';
  changedFiles?: string[];
  worktreePath?: string;
  errorMessage?: string;
  merged?: boolean;
}

export interface KanbanTask {
  id: string;
  title: string;
  body: string;
  status: string;
  labels: string[];
  assignee?: string;
  url?: string;
  providerId: string;
  agent?: string;
  meta?: Record<string, unknown>;
  copilotSession?: CopilotSession;
}

export interface AgentOption {
  slug: string;
  displayName: string;
  canSquad?: boolean;
}

export interface GenAiProviderOption {
  id: string;
  displayName: string;
  icon: string;
  disabled?: boolean;
  disabledReason?: string;
}

export interface SquadStatus {
  activeCount: number;
  maxSessions: number;
  autoSquadEnabled: boolean;
}

export interface FileChangeInfo {
  path: string;
  status: 'added' | 'modified' | 'deleted';
}

export interface MobileDeviceInfo {
  ip: string;
  lastAccess: string;
}

export interface TaskLogEntry {
  ts: string;
  source: 'board' | 'agent' | 'tool' | 'system';
  text: string;
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'tool';
  text: string;
  ts: string;
}

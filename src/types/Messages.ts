import { KanbanTask } from './KanbanTask';
import { ColumnId } from './ColumnId';

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

export type HostToWebView =
  | { type: 'tasksUpdate'; tasks: KanbanTask[]; columns: Column[] }
  | { type: 'providerStatus'; providerId: string; status: 'ok' | 'error' | 'loading'; message?: string }
  | { type: 'themeChange'; kind: 'dark' | 'light' | 'hc' }
  | { type: 'squadStatus'; status: SquadStatus }
  | { type: 'agentsAvailable'; agents: AgentOption[] }
  | { type: 'mcpStatus'; enabled: boolean };

// ── WebView → Host ──────────────────────────────────────────────────────────

export type WebViewToHost =
  | { type: 'taskMoved'; taskId: string; toCol: ColumnId; index: number }
  | { type: 'openCopilot'; taskId: string; providerId: string; agentSlug?: string }
  | { type: 'refreshRequest'; providerId?: string }
  | { type: 'ready' }
  | { type: 'startSquad'; agentSlug?: string }
  | { type: 'toggleAutoSquad'; agentSlug?: string }
  | { type: 'toggleMcp' };

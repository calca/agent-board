import { KanbanTask } from './KanbanTask';
import { ColumnId } from './ColumnId';

// ── Host → WebView ──────────────────────────────────────────────────────────

export interface Column {
  id: ColumnId;
  label: string;
}

export type CopilotMode = 'cloud' | 'local' | 'background' | 'chat';

/** Snapshot of the squad manager state sent to the WebView. */
export interface SquadStatus {
  /** Number of copilot sessions currently running. */
  activeCount: number;
  /** Maximum parallel sessions allowed. */
  maxSessions: number;
  /** Whether auto-squad mode is enabled. */
  autoSquadEnabled: boolean;
}

export type HostToWebView =
  | { type: 'tasksUpdate'; tasks: KanbanTask[]; columns: Column[] }
  | { type: 'providerStatus'; providerId: string; status: 'ok' | 'error' | 'loading'; message?: string }
  | { type: 'themeChange'; kind: 'dark' | 'light' | 'hc' }
  | { type: 'squadStatus'; status: SquadStatus };

// ── WebView → Host ──────────────────────────────────────────────────────────

export type WebViewToHost =
  | { type: 'taskMoved'; taskId: string; toCol: ColumnId; index: number }
  | { type: 'openCopilot'; taskId: string; mode: CopilotMode }
  | { type: 'refreshRequest'; providerId?: string }
  | { type: 'ready' }
  | { type: 'startSquad' }
  | { type: 'toggleAutoSquad' };

import { KanbanTask } from './KanbanTask';
import { ColumnId } from './ColumnId';

// ── Host → WebView ──────────────────────────────────────────────────────────

export interface Column {
  id: ColumnId;
  label: string;
}

export type HostToWebView =
  | { type: 'tasksUpdate'; tasks: KanbanTask[]; columns: Column[] }
  | { type: 'providerStatus'; providerId: string; status: 'ok' | 'error' | 'loading'; message?: string }
  | { type: 'themeChange'; kind: 'dark' | 'light' | 'hc' };

// ── WebView → Host ──────────────────────────────────────────────────────────

export type WebViewToHost =
  | { type: 'taskMoved'; taskId: string; toCol: ColumnId; index: number }
  | { type: 'openCopilot'; taskId: string; providerId: string }
  | { type: 'refreshRequest'; providerId?: string }
  | { type: 'ready' };

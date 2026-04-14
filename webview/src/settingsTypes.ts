/**
 * Types specific to the Settings webview.
 */

export interface ProviderField {
  key: string;
  label: string;
  type: 'text' | 'number' | 'boolean';
  placeholder?: string;
  hint?: string;
  required?: boolean;
}

export interface ProviderDiagnostic {
  severity: 'ok' | 'warning' | 'error';
  message: string;
}

export interface ProviderInfo {
  id: string;
  displayName: string;
  icon: string;
  enabled: boolean;
  configSection: string;
  fields: ProviderField[];
  diagnostic: ProviderDiagnostic;
}

/**
 * Subset of ProjectConfigData relevant to the settings form.
 * Kept as a loose Record so we can forward it to the host as-is.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type SettingsConfig = Record<string, any>;

export type SectionId =
  | 'providers'
  | 'kanban'
  | 'worktree'
  | 'squad'
  | 'mcp'
  | 'notifications'
  | 'logging';

export const SECTIONS: { id: SectionId; label: string }[] = [
  { id: 'providers', label: 'Providers' },
  { id: 'kanban', label: 'Kanban' },
  { id: 'worktree', label: 'Worktree' },
  { id: 'squad', label: 'Squad' },
  { id: 'mcp', label: 'MCP' },
  { id: 'notifications', label: 'Notifications' },
  { id: 'logging', label: 'Logging' },
];

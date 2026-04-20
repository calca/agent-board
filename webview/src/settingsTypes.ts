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

// ── GenAI provider descriptor types (mirror of host-side types) ──────

/** Option for a `select`-type GenAI setting. */
export interface GenAiSettingOption {
  label: string;
  value: string | number | boolean;
}

/** Describes a single configurable setting exposed by a GenAI provider. */
export interface GenAiSettingDescriptor {
  key: string;
  title: string;
  description: string;
  type: 'boolean' | 'string' | 'number' | 'select';
  defaultValue: string | number | boolean;
  options?: GenAiSettingOption[];
}

/** Full GenAI provider metadata received from the host. */
export interface GenAiProviderInfo {
  id: string;
  displayName: string;
  icon: string;
  description: string;
  settings: GenAiSettingDescriptor[];
}

/**
 * Subset of ProjectConfigData relevant to the settings form.
 * Kept as a loose Record so we can forward it to the host as-is.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type SettingsConfig = Record<string, any>;

export type SectionId =
  | 'providers'
  | 'genai'
  | 'kanban'
  | 'worktree'
  | 'squad'
  | 'mcp'
  | 'logging'
  | 'about';

export const SECTIONS: { id: SectionId; label: string }[] = [
  { id: 'providers', label: 'Issues' },
  { id: 'genai', label: 'GenAI' },
  { id: 'kanban', label: 'Kanban' },
  { id: 'worktree', label: 'Worktree' },
  { id: 'squad', label: 'Squad' },
  { id: 'mcp', label: 'MCP' },
  { id: 'logging', label: 'Logging' },
  { id: 'about', label: 'About' },
];

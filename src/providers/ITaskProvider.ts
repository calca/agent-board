import * as vscode from 'vscode';
import { KanbanTask } from '../types/KanbanTask';

// ── Provider configuration types ──────────────────────────────────────────

/** Describes a single configuration field a provider requires. */
export interface ProviderConfigField {
  /** Config key inside the provider's section (e.g. `'owner'` for `github.owner`). */
  key: string;
  label: string;
  type: 'string' | 'boolean' | 'number';
  placeholder?: string;
  hint?: string;
  required?: boolean;
}

export type ProviderDiagnosticSeverity = 'ok' | 'warning' | 'error';

/** Result of a provider self-diagnosis (are all prerequisites met?). */
export interface ProviderDiagnostic {
  severity: ProviderDiagnosticSeverity;
  message: string;
}

// ── Provider contract ─────────────────────────────────────────────────────

/**
 * Contract that every task data source must implement.
 * Providers are registered in `ProviderRegistry` and consumed by the
 * Kanban panel and the Copilot launcher — never imported directly.
 */
export interface ITaskProvider {
  readonly id: string;
  readonly displayName: string;
  /** `vscode.ThemeIcon` identifier, e.g. `'github'` or `'file-code'`. */
  readonly icon: string;

  getTasks(): Promise<KanbanTask[]>;
  updateTask(task: KanbanTask): Promise<void>;
  refresh(): Promise<void>;
  dispose(): void;

  readonly onDidChangeTasks: vscode.Event<KanbanTask[]>;

  // ── Configuration & diagnostics ──────────────────────────────────────

  /** Configuration fields the provider exposes for the Settings UI. */
  getConfigFields(): ProviderConfigField[];

  /**
   * Run a self-check and report whether the provider is correctly
   * configured (e.g. binary found, auth available, required fields set).
   */
  diagnose(): Promise<ProviderDiagnostic>;

  /**
   * Whether this provider is enabled for the current project.
   * Reads the `enabled` flag from the provider's config section.
   */
  isEnabled(): boolean;

  /**
   * Return a prompt fragment that instructs the GenAI model to retrieve
   * the full issue / work-item details before starting work.
   *
   * The prompt is prepended to the context sent to the model so it
   * executes the retrieval command first.
   *
   * Providers whose tasks are already complete locally (e.g. JSON files)
   * may omit this method — the launcher treats `undefined` as "no
   * retrieval needed".
   */
  getIssueRetrievalPrompt?(task: KanbanTask): string | undefined;
}

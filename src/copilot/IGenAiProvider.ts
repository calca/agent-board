import { KanbanTask, CopilotSessionInfo } from '../types/KanbanTask';

/**
 * Scope of a GenAI provider.
 *
 * - `global` — integrates with VS Code APIs (chat, cloud, copilot-cli).
 *   Enabled by default via VS Code settings, overridable per project.
 * - `project` — per-project providers (e.g. Ollama, Mistral CLI).
 *   Enabled and configured only in `.agent-board/config.json`.
 */
export type GenAiProviderScope = 'global' | 'project';

/**
 * Per-provider configuration stored in `genAiProviders.<id>` inside
 * `.agent-board/config.json` (or VS Code settings for global providers).
 */
export interface GenAiProviderConfig {
  enabled?: boolean;
  model?: string;
  endpoint?: string;
}

/**
 * Contract that every GenAI provider must implement.
 *
 * Providers are registered in `GenAiProviderRegistry` and consumed by
 * `CopilotLauncher` / `ModelSelector` — never imported directly.
 */
export interface IGenAiProvider {
  /** Unique identifier, e.g. `'chat'`, `'cloud'`, `'ollama'`. */
  readonly id: string;
  /** Human-readable name shown in the Quick Pick. */
  readonly displayName: string;
  /** `vscode.ThemeIcon` codicon identifier, e.g. `'comment-discussion'`. */
  readonly icon: string;
  /** Whether this is a VS Code–integrated (`global`) or per-project (`project`) provider. */
  readonly scope: GenAiProviderScope;

  /** Check whether the provider can be used in the current environment. */
  isAvailable(): Promise<boolean>;
  /** Execute the provider with the given prompt (and optional task for context). */
  run(prompt: string, task?: KanbanTask): Promise<void>;
  /**
   * Return provider-specific session links/shortcuts for a task.
   * Optional — providers that don't support session tracking can omit this.
   */
  getSessionInfo?(task: KanbanTask): CopilotSessionInfo | undefined;
  /** Clean up resources. */
  dispose(): void;
}

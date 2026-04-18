import * as vscode from 'vscode';
import { CopilotSessionInfo, KanbanTask } from '../types/KanbanTask';

/**
 * Scope of a GenAI provider.
 *
 * - `global` — integrates with VS Code APIs (chat, cloud, copilot-cli).
 *   Enabled by default via VS Code settings, overridable per project.
 * - `project` — per-project providers registered via the extension API.
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
  /** Enable /yolo mode — auto-approve all changes without confirmation. */
  yolo?: boolean;
  /** Enable /fleet mode — optimise prompt for parallel fleet execution. */
  fleet?: boolean;
  /** Enable --silent mode — suppress interactive prompts and progress output. */
  silent?: boolean;
}

/**
 * Contract that every GenAI provider must implement.
 *
 * Providers are registered in `GenAiProviderRegistry` and consumed by
 * `CopilotLauncher` / `ModelSelector` — never imported directly.
 */
export interface IGenAiProvider {
  /** Unique identifier, e.g. `'chat'`, `'cloud'`, `'my-provider'`. */
  readonly id: string;
  /** Human-readable name shown in the Quick Pick. */
  readonly displayName: string;
  /** `vscode.ThemeIcon` codicon identifier, e.g. `'comment-discussion'`. */
  readonly icon: string;
  /** Whether this is a VS Code–integrated (`global`) or per-project (`project`) provider. */
  readonly scope: GenAiProviderScope;
  /**
   * Whether this provider supports running inside a git worktree.
   *
   * When `true` **and** the user has not disabled worktree creation,
   * `CopilotLauncher` will create a temporary worktree before calling
   * `run()` and clean it up afterwards.
   *
   * Defaults to `false` when not set.
   */
  readonly supportsWorktree?: boolean;

  /**
   * When `true`, the SquadManager will NOT automatically advance the
   * task to the done/failed column after `run()` returns.
   *
   * Use this for interactive providers (e.g. `chat`) where the user
   * controls when the task progresses — the task is moved to `inprogress`
   * on launch but subsequent column transitions are left to the human.
   *
   * Defaults to `false` when not set.
   */
  readonly disableAutoAdvance?: boolean;

  /**
   * Optional streaming event. When present, `CopilotLauncher` automatically
   * subscribes and forwards chunks to the `StreamController` / KanbanPanel.
   */
  readonly onDidStream?: vscode.Event<string>;
  /**
   * Optional event that fires when a tool call is being executed.
   * Payload: human-readable status string, e.g. "Leggendo src/auth.ts…"
   */
  readonly onDidToolCall?: vscode.Event<string>;
  /** Check whether the provider can be used in the current environment. */
  isAvailable(): Promise<boolean>;
  /**
   * Execute the provider with the given prompt and optional task context.
   * `worktreePath` — when available, the isolated git worktree path that
   * the provider should operate in. Providers that don't use it can ignore it.
   */
  run(prompt: string, task?: KanbanTask, worktreePath?: string): Promise<void>;
  /**
   * Send a follow-up user message into the current multi-turn session.
   * Only supported by providers that maintain conversation history (e.g. copilot-lm).
   */
  sendFollowUp?(text: string): Promise<void>;
  /**
   * Cancel the currently running request.
   * Optional — providers that don't support cancellation can omit this.
   */
  cancel?(): void;
  /**
   * Return provider-specific session links/shortcuts for a task.
   * Optional — providers that don't support session tracking can omit this.
   */
  getSessionInfo?(task: KanbanTask): CopilotSessionInfo | undefined;
  /** Clean up resources. */
  dispose(): void;
}

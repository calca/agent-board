import * as vscode from 'vscode';
import { CopilotSessionInfo, KanbanTask } from '../types/KanbanTask';

/**
 * Scope of a GenAI provider.
 *
 * - `global` — integrates with VS Code APIs (VS Code Chat, GitHub Copilot, VS Code API).
 *   Enabled by default via VS Code settings, overridable per project.
 * - `project` — per-project providers registered via the extension API.
 *   Enabled and configured only in `.agent-board/config.json`.
 */
export type GenAiProviderScope = 'global' | 'project';

// ── Setting descriptors ─────────────────────────────────────────────────

/** Allowed types for a GenAI provider setting. */
export type GenAiSettingType = 'boolean' | 'string' | 'number' | 'select';

/** Option for a `select` setting. */
export interface GenAiSettingOption {
  label: string;
  value: string | number | boolean;
}

/**
 * Describes a single configurable setting exposed by a GenAI provider.
 *
 * The Settings UI renders form controls dynamically from these descriptors
 * so each provider only shows its own relevant settings.
 */
export interface GenAiSettingDescriptor {
  /** Config key stored in `genAiProviders.<providerId>.<key>`. */
  key: string;
  /** Short human-readable label shown in the Settings UI. */
  title: string;
  /** Longer explanation shown as hint text below the control. */
  description: string;
  /** Control type rendered in the UI. */
  type: GenAiSettingType;
  /** Default value when neither project config nor VS Code settings override it. */
  defaultValue: string | number | boolean;
  /** Available choices — only used when `type` is `'select'`. */
  options?: GenAiSettingOption[];
}

/**
 * Bag of per-provider configuration values.
 *
 * The keys correspond to {@link GenAiSettingDescriptor.key} entries
 * declared by each provider via `getSettingsDescriptors()`.
 */
export type GenAiProviderConfig = Record<string, unknown>;

/**
 * Contract that every GenAI provider must implement.
 *
 * Providers are registered in `GenAiProviderRegistry` and consumed by
 * `CopilotLauncher` / `ModelSelector` — never imported directly.
 */
export interface IGenAiProvider {
  /** Unique identifier, e.g. `'vscode-chat'`, `'github-copilot'`, `'my-provider'`. */
  readonly id: string;
  /** Human-readable name shown in the Quick Pick. */
  readonly displayName: string;
  /** Short description shown in the Settings UI below the provider name. */
  readonly description: string;
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
   * Whether this provider can participate in squad (parallel) sessions.
   *
   * When `false`, the provider is excluded from the squad provider picker.
   * Defaults to `true` when not set.
   */
  readonly canSquad?: boolean;

  /**
   * When `true`, the provider is disabled if the workspace is not
   * inside a git repository.  Defaults to `false` when not set.
   */
  readonly requiresGit?: boolean;

  /**
   * When `true`, the provider is disabled if the workspace is not
   * inside a GitHub-hosted repository.  Defaults to `false` when not set.
   */
  readonly requiresGitHub?: boolean;

  /**
   * When `true`, the provider handles agent selection natively
   * (e.g. via a `--agent` CLI flag) instead of relying on the
   * `AGENT_PROMPT_PREFIX` injected by `CopilotLauncher`.
   *
   * Defaults to `false` when not set.
   */
  readonly handlesAgentNatively?: boolean;

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
  /**
   * Optional structured event stream for the ChatBridge.
   * When present, `CopilotLauncher` subscribes and forwards events to the
   * webview ChatContainer via `chatBlock`/`chatStart`/`chatEnd` messages.
   */
  readonly onDidCopilotEvent?: vscode.Event<import('./providers/copilot-sdk/types').CopilotEvent>;

  /**
   * Create a provider instance isolated for a single run.
   *
   * Useful for providers with internal mutable state/event emitters that
   * are not safe when multiple tasks run in parallel (e.g. squad mode).
   *
   * When omitted, the shared registry instance is used.
   */
  createIsolatedInstance?(): IGenAiProvider;

  /** Check whether the provider can be used in the current environment. */
  isAvailable(): Promise<boolean>;
  /**
   * Execute the provider with the given prompt and optional task context.
   * `worktreePath` — when available, the isolated git worktree path that
   * the provider should operate in. Providers that don't use it can ignore it.
   * `agentSlug` — when present, the slug of the custom agent selected by the
   * user.  Providers with `handlesAgentNatively` use this to delegate agent
   * resolution to their backend (e.g. `copilot --agent <slug>`).
   */
  run(prompt: string, task?: KanbanTask, worktreePath?: string, agentSlug?: string): Promise<void>;
  /**
   * Send a follow-up user message into the current multi-turn session.
   * Only supported by providers that maintain conversation history (e.g. VS Code API / vscode-api).
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

  /**
   * Return the list of configurable settings this provider exposes.
   *
   * The Settings UI renders form controls dynamically from these
   * descriptors. Providers with no configurable settings return `[]`.
   */
  getSettingsDescriptors(): GenAiSettingDescriptor[];

  /**
   * Apply a (possibly partial) configuration bag at runtime.
   *
   * Called by `SettingsPanel` after the user saves settings so the
   * provider can update its internal state without requiring a restart.
   */
  applyConfig(config: GenAiProviderConfig): void;

  /** Clean up resources. */
  dispose(): void;
}

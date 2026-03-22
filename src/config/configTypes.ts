/**
 * Per-provider configuration for a GenAI provider stored in
 * `genAiProviders.<id>` inside `.agent-board/config.json`.
 */
export interface GenAiProviderConfigEntry {
  enabled?: boolean;
  model?: string;
  endpoint?: string;
}

/**
 * Shape of `.agent-board/config.json` in the workspace root.
 *
 * Every VS Code setting under `agentBoard.*` can be overridden here.
 * Project-file values take priority over VS Code settings.
 */
export interface ProjectConfigData {
  github?: {
    owner?: string;
    repo?: string;
  };
  jsonProvider?: {
    path?: string;
  };
  beadsProvider?: {
    executable?: string;
  };
  /**
   * Git worktree settings.
   *
   * When enabled, providers that declare `supportsWorktree` will run
   * inside an isolated git worktree created under
   * `.agent-board/worktrees/<taskId>`.
   */
  worktree?: {
    /** Whether worktree creation is enabled.  Defaults to `true`. */
    enabled?: boolean;
  };
  /**
   * Per-provider GenAI configuration.
   *
   * Global providers (chat, cloud, copilot-cli) have VS Code settings
   * and can be overridden here.  Project providers (ollama, mistral) are
   * enabled and configured **only** here.
   */
  genAiProviders?: Record<string, GenAiProviderConfigEntry>;
  kanban?: {
    columns?: string[];
  };
  pollInterval?: number;
  logLevel?: string;
}

/**
 * Pure extraction logic — resolves GitHub `owner`/`repo`.
 *
 * Resolution order: project config file → VS Code settings → default ('').
 */
export function extractGitHubConfig(
  fileConfig: ProjectConfigData | undefined,
  settingConfig?: { owner?: string; repo?: string },
): { owner: string; repo: string } {
  return {
    owner: fileConfig?.github?.owner || settingConfig?.owner || '',
    repo: fileConfig?.github?.repo || settingConfig?.repo || '',
  };
}

/**
 * Resolve a single config value: project file → VS Code setting → default.
 */
export function resolveConfigValue<T>(
  fileValue: T | undefined,
  settingValue: T,
): T {
  return fileValue !== undefined && fileValue !== '' ? fileValue : settingValue;
}

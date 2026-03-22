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
  copilot?: {
    defaultMode?: string;
    localModel?: string;
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
 * Pure extraction logic — resolves GitHub `owner`/`repo` from
 * the per-project config file data.
 */
export function extractGitHubConfig(
  fileConfig: ProjectConfigData | undefined,
): { owner: string; repo: string } {
  return {
    owner: fileConfig?.github?.owner || '',
    repo: fileConfig?.github?.repo || '',
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

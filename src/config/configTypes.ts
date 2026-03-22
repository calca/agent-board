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

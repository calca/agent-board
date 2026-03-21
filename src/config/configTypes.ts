/**
 * Shape of `.agent-board/config.json` in the workspace root.
 */
export interface ProjectConfigData {
  github?: {
    owner?: string;
    repo?: string;
  };
}

/**
 * Pure merge logic — resolves GitHub `owner`/`repo` from a file-based
 * config and VS Code setting values.
 *
 * Priority: file config > settings > empty string.
 */
export function mergeGitHubConfig(
  fileConfig: ProjectConfigData | undefined,
  settingsOwner: string,
  settingsRepo: string,
): { owner: string; repo: string } {
  return {
    owner: fileConfig?.github?.owner || settingsOwner,
    repo: fileConfig?.github?.repo || settingsRepo,
  };
}

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

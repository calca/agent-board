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
  squad?: {
    /** Maximum parallel agent sessions (default 10). */
    maxSessions?: number;
    /** Column from which the squad picks tasks to launch (default "todo"). */
    sourceColumn?: string;
    /** Column tasks are moved to when the agent starts working (default "inprogress"). */
    activeColumn?: string;
    /** Column tasks are moved to when the agent completes (default "review"). */
    doneColumn?: string;
    /** Auto-squad polling interval in milliseconds (default 15 000). */
    autoSquadInterval?: number;
    /** Maximum retries for a failed session (default 0 = no retry). */
    maxRetries?: number;
    /**
     * Ordered list of label strings used to prioritise tasks.
     * Tasks matching an earlier label are launched first.
     */
    priorityLabels?: string[];
    /**
     * Maximum time in milliseconds a session may run before being
     * timed out and marked as failed (default 300 000 = 5 min).
     * Set to 0 to disable timeout.
     */
    sessionTimeout?: number;
  };
  notifications?: {
    /** Show a VS Code notification when a task is automatically moved to the active column. */
    taskActive?: boolean;
    /** Show a VS Code notification when a task is automatically moved to the done column. */
    taskDone?: boolean;
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

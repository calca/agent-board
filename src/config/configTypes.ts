/**
 * Per-provider configuration for a GenAI provider stored in
 * `genAiProviders.<id>` inside `.agent-board/config.json`.
 */
export interface GenAiProviderConfigEntry {
  enabled?: boolean;
  model?: string;
  endpoint?: string;
  /** Enable /yolo mode — auto-approve all changes without confirmation. */
  yolo?: boolean;
  /** Enable /fleet mode — optimise prompt for parallel fleet execution. */
  fleet?: boolean;
}

/**
 * Shape of `.agent-board/config.json` in the workspace root.
 *
 * Every VS Code setting under `agentBoard.*` can be overridden here.
 * Project-file values take priority over VS Code settings.
 */
export interface ProjectConfigData {
  github?: {
    enabled?: boolean;
    owner?: string;
    repo?: string;
    /** Only fetch issues assigned to the current user. */
    onlyAssignedToMe?: boolean;
  };
  jsonProvider?: {
    enabled?: boolean;
    path?: string;
  };
  markdownProvider?: {
    enabled?: boolean;
    /** Workspace-relative or absolute path to the inbox directory containing .md task files. */
    inboxPath?: string;
    /** Workspace-relative or absolute path to the directory where done .md files are moved. */
    donePath?: string;
  };
  beadsProvider?: {
    enabled?: boolean;
    executable?: string;
    /** Only fetch items assigned to the current user. */
    onlyAssignedToMe?: boolean;
  };
  azureDevOps?: {
    enabled?: boolean;
    /** Azure DevOps organisation URL or name. */
    organization?: string;
    /** Project name inside the organisation. */
    project?: string;
    /** Only fetch work items assigned to the current user. */
    onlyAssignedToMe?: boolean;
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
    /**
     * When `true`, a confirmation dialog is shown before removing the worktree
     * at the end of a session.  Defaults to `false` (auto-remove silently).
     */
    confirmCleanup?: boolean;
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
     * Maximum time in milliseconds a session may run before being
     * timed out and marked as failed (default 300 000 = 5 min).
     * Set to 0 to disable timeout.
     */
    sessionTimeout?: number;
    /**
     * Delay in milliseconds between consecutive session launches.
     * Prevents rate-limiting when starting multiple sessions at once.
     * Default 0 = no cooldown.
     */
    cooldownMs?: number;
  };
  notifications?: {
    /** Show a VS Code notification when a task is automatically moved to the active column. */
    taskActive?: boolean;
    /** Show a VS Code notification when a task is automatically moved to the done column. */
    taskDone?: boolean;
  };
  /**
   * When `true`, Agent Board posts a comment on the GitHub issue after a
   * successful agent session summarising the changes made.
   *
   * VS Code setting: `agentBoard.postAgentSummaryToIssue`
   */
  postAgentSummaryToIssue?: boolean;
  /**
   * MCP (Model Context Protocol) server settings.
   *
   * When enabled, Agent Board exposes a stdio-based MCP server that
   * lets external agents list, read, and update tasks on the board.
   */
  mcp?: {
    /** Whether the MCP server is enabled.  Defaults to `false`. */
    enabled?: boolean;
    /**
     * Workspace-relative or absolute path to the JSON task file
     * the MCP server operates on.  Defaults to the jsonProvider path.
     */
    tasksPath?: string;
  };
  pollInterval?: number;
  logLevel?: string;
  logging?: {
    /** Minimum log level written to file: trace | debug | info | warn | error (default "info"). */
    level?: string;
    /** Number of days to retain daily log files (default 7). */
    retentionDays?: number;
  };
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

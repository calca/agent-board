import * as vscode from 'vscode';
import { ProjectConfig } from '../config/ProjectConfig';
import { DiffWatcher } from '../diff/DiffWatcher';
import { ProviderRegistry } from '../providers/ProviderRegistry';
import { StreamRegistry } from '../stream/StreamController';
import { KanbanTask } from '../types/KanbanTask';
import { formatError } from '../utils/errorUtils';
import { Logger } from '../utils/logger';
import { AgentInfo, readAgentInstructions } from './agentDiscovery';
import { ContextBuilder } from './ContextBuilder';
import { GenAiProviderRegistry } from './GenAiProviderRegistry';
import { createWorktree, removeWorktree, WorktreeInfo } from './WorktreeManager';

/**
 * Entry point for launching a GenAI session with task context.
 *
 * Receives a `taskId` and a GenAI provider `id`, resolves the task
 * from the task registry, builds context via `ContextBuilder`, and
 * delegates to the matching `IGenAiProvider`.
 *
 * When the selected provider declares `supportsWorktree` and worktree
 * creation is enabled (default), a git worktree is created before the
 * provider runs so it can operate on an isolated branch.
 */
export const AGENT_PROMPT_PREFIX = (name: string, instructions: string): string =>
  `## Agent: ${name}\n\n${instructions}\n\n---\n\n`;

export class CopilotLauncher {
  private readonly logger = Logger.getInstance();
  private readonly streamRegistry = new StreamRegistry();
  private readonly diffWatchers = new Map<string, DiffWatcher>();
  /** Tracks the provider currently running for a given taskId (for cancellation). */
  private readonly activeProviders = new Map<string, import('./IGenAiProvider').IGenAiProvider>();

  constructor(
    private readonly registry: ProviderRegistry,
    private readonly context: vscode.ExtensionContext,
    private readonly genAiRegistry: GenAiProviderRegistry,
    private agents: AgentInfo[] = [],
  ) {}

  /** The shared stream registry (used by KanbanPanel for real-time output). */
  getStreamRegistry(): StreamRegistry {
    return this.streamRegistry;
  }

  /** Get the DiffWatcher for a session, if any. */
  getDiffWatcher(sessionId: string): DiffWatcher | undefined {
    return this.diffWatchers.get(sessionId);
  }

  /** Cancel the running provider for a task, if any. */
  cancelSession(taskId: string): void {
    const provider = this.activeProviders.get(taskId);
    if (provider?.cancel) {
      provider.cancel();
      this.logger.info(`CopilotLauncher: cancelled session for task ${taskId}`);
    }
  }

  /** Update the cached list of discovered agents. */
  setAgents(agents: AgentInfo[]): void {
    this.agents = agents;
  }

  async launch(taskId: string, providerId: string, agentSlug?: string): Promise<void> {
    this.logger.info(`CopilotLauncher: launching provider "${providerId}" for task ${taskId}${agentSlug ? ` with agent "${agentSlug}"` : ''}`);

    const provider = this.genAiRegistry.get(providerId);
    if (!provider) {
      vscode.window.showErrorMessage(`GenAI provider "${providerId}" not found.`);
      return;
    }

    const task = await this.resolveTask(taskId);
    if (!task) {
      vscode.window.showErrorMessage(`Task "${taskId}" not found.`);
      return;
    }

    // ── Worktree support ──────────────────────────────────────────────
    let worktree: WorktreeInfo | undefined;
    if (provider.supportsWorktree && this.isWorktreeEnabled(provider.id)) {
      worktree = await this.tryCreateWorktree(taskId);
    }

    let prompt = ContextBuilder.build(task);

    // ── Agent instructions ────────────────────────────────────────────
    if (agentSlug) {
      const agentInfo = this.agents.find(a => a.slug === agentSlug);
      if (agentInfo) {
        const instructions = readAgentInstructions(agentInfo.filePath);
        if (instructions) {
          prompt = AGENT_PROMPT_PREFIX(agentInfo.displayName, instructions) + prompt;
        }
      }
    }

    if (worktree) {
      this.logger.info(`CopilotLauncher: worktree ready at ${worktree.path} (branch ${worktree.branch})`);
    }

    // ── Stream + DiffWatcher ──────────────────────────────────────────
    const stream = this.streamRegistry.getOrCreate(taskId);
    const watchRoot = worktree?.path ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (watchRoot) {
      const dw = new DiffWatcher(watchRoot);
      this.diffWatchers.set(taskId, dw);
    }

    this.activeProviders.set(taskId, provider);
    try {
      await provider.run(prompt, task, worktree?.path);
    } finally {
      this.activeProviders.delete(taskId);
      // Cleanup worktree after session (optionally ask for confirmation)
      if (worktree) {
        await this.tryCleanupWorktree(taskId, worktree.path);
      }
      // Cleanup diff watcher (stream kept until explicit removal)
      const dw = this.diffWatchers.get(taskId);
      if (dw) {
        dw.dispose();
        this.diffWatchers.delete(taskId);
      }
    }
  }

  // ── Private helpers ─────────────────────────────────────────────────

  /**
   * Optionally confirm with the user before removing the worktree.
   * Controlled by `worktree.confirmCleanup` in the project config.
   */
  private async tryCleanupWorktree(taskId: string, worktreePath: string): Promise<void> {
    const projectCfg = ProjectConfig.getProjectConfig();
    const confirm = projectCfg?.worktree?.confirmCleanup
      ?? vscode.workspace.getConfiguration('agentBoard').get<boolean>('worktree.confirmCleanup', false);

    if (confirm) {
      const answer = await vscode.window.showInformationMessage(
        `Session complete. Remove worktree at:\n${worktreePath}?`,
        { modal: true },
        'Remove',
        'Keep',
      );
      if (answer !== 'Remove') {
        this.logger.info(`CopilotLauncher: worktree kept at ${worktreePath} (user chose to keep)`);
        return;
      }
    }

    await this.tryRemoveWorktree(taskId);
  }

  private async tryRemoveWorktree(taskId: string): Promise<void> {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) {
      return;
    }
    const repoRoot = folders[0].uri.fsPath;
    try {
      await removeWorktree(repoRoot, taskId);
      this.logger.info(`CopilotLauncher: worktree removed for task ${taskId}`);
    } catch (err) {
      this.logger.error('CopilotLauncher: worktree removal failed:', formatError(err));
    }
  }

  private isWorktreeEnabled(providerId?: string): boolean {
    // Copilot CLI must always run in a dedicated worktree.
    if (providerId === 'copilot-cli') {
      return true;
    }

    const projectCfg = ProjectConfig.getProjectConfig();
    const fileValue = projectCfg?.worktree?.enabled;
    if (fileValue !== undefined) {
      return fileValue;
    }
    const settingValue = vscode.workspace
      .getConfiguration('agentBoard')
      .get<boolean>('worktree.enabled');
    return settingValue ?? true;
  }

  private async tryCreateWorktree(taskId: string): Promise<WorktreeInfo | undefined> {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) {
      return undefined;
    }

    const repoRoot = folders[0].uri.fsPath;
    try {
      const info = await createWorktree(repoRoot, taskId);
      if (info) {
        this.logger.info(
          `CopilotLauncher: worktree created at ${info.path} (branch: ${info.branch})`,
        );
      }
      return info;
    } catch (err) {
      this.logger.error('CopilotLauncher: worktree creation failed:', formatError(err));
      vscode.window.showWarningMessage(`Worktree creation failed: ${formatError(err)}`);
      return undefined;
    }
  }

  private async resolveTask(taskId: string): Promise<KanbanTask | undefined> {
    const [providerId] = taskId.split(':');
    const provider = this.registry.get(providerId);
    if (!provider) {
      return undefined;
    }
    const tasks = await provider.getTasks();
    return tasks.find(t => t.id === taskId);
  }
}

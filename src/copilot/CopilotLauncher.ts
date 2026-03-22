import * as vscode from 'vscode';
import { KanbanTask } from '../types/KanbanTask';
import { ProviderRegistry } from '../providers/ProviderRegistry';
import { ContextBuilder } from './ContextBuilder';
import { GenAiProviderRegistry } from './GenAiProviderRegistry';
import { Logger } from '../utils/logger';
import { createWorktree, WorktreeInfo } from './WorktreeManager';
import { ProjectConfig } from '../config/ProjectConfig';

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
export class CopilotLauncher {
  private readonly logger = Logger.getInstance();

  constructor(
    private readonly registry: ProviderRegistry,
    private readonly context: vscode.ExtensionContext,
    private readonly genAiRegistry: GenAiProviderRegistry,
  ) {}

  async launch(taskId: string, providerId: string): Promise<void> {
    this.logger.info(`CopilotLauncher: launching provider "${providerId}" for task ${taskId}`);

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
    // Worktrees are created once and persist so the user (or agent) can
    // inspect the isolated branch after the provider finishes.
    let worktree: WorktreeInfo | undefined;
    if (provider.supportsWorktree && this.isWorktreeEnabled()) {
      worktree = await this.tryCreateWorktree(taskId);
    }

    const prompt = ContextBuilder.build(task);
    await provider.run(prompt, task);

    if (worktree) {
      this.logger.info(`CopilotLauncher: worktree ready at ${worktree.path} (branch ${worktree.branch})`);
    }
  }

  // ── Private helpers ─────────────────────────────────────────────────

  /**
   * Determine whether worktree creation is enabled.
   *
   * Resolution order: `.agent-board/config.json` → VS Code setting
   * `agentBoard.worktree.enabled` → default `true`.
   */
  private isWorktreeEnabled(): boolean {
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

  /**
   * Attempt to create a worktree for the given task.
   * Returns `undefined` (and shows an info message) when the workspace
   * is not a git repository.
   */
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
      this.logger.error('CopilotLauncher: worktree creation failed:', String(err));
      vscode.window.showWarningMessage(`Worktree creation failed: ${err}`);
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

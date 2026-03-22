import * as vscode from 'vscode';
import { KanbanTask } from '../types/KanbanTask';
import { ProviderRegistry } from '../providers/ProviderRegistry';
import { ContextBuilder } from './ContextBuilder';
import { GenAiProviderRegistry } from './GenAiProviderRegistry';
import { ProjectConfig } from '../config/ProjectConfig';
import { Logger } from '../utils/logger';

/**
 * Entry point for launching a GenAI session with task context.
 *
 * Receives a `taskId` and a GenAI provider `id`, resolves the task
 * from the task registry, builds context via `ContextBuilder`, and
 * delegates to the matching `IGenAiProvider`.
 *
 * Sends VS Code notifications on start/finish when enabled in config.
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

    // Notify on start
    if (this.shouldNotify('copilotStart')) {
      vscode.window.showInformationMessage(
        `Copilot started for "${task.title}" (provider: ${provider.displayName})`,
      );
    }

    const prompt = ContextBuilder.build(task);

    try {
      await provider.run(prompt, task);

      // Notify on finish
      if (this.shouldNotify('copilotFinish')) {
        vscode.window.showInformationMessage(
          `Copilot finished for "${task.title}" (provider: ${provider.displayName})`,
        );
      }
    } catch (err) {
      if (this.shouldNotify('copilotFinish')) {
        vscode.window.showErrorMessage(
          `Copilot failed for "${task.title}": ${err}`,
        );
      }
      throw err;
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

  private shouldNotify(key: 'copilotStart' | 'copilotFinish'): boolean {
    const projectCfg = ProjectConfig.getProjectConfig();
    return ProjectConfig.resolve(
      projectCfg?.notifications?.[key],
      `notifications.${key}`,
      true,
    );
  }
}

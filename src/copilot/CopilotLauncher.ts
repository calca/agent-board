import * as vscode from 'vscode';
import { KanbanTask } from '../types/KanbanTask';
import { CopilotMode } from '../types/Messages';
import { ProviderRegistry } from '../providers/ProviderRegistry';
import { ContextBuilder } from './ContextBuilder';
import { GenAiProviderRegistry } from './GenAiProviderRegistry';
import { CloudRunner } from './CloudRunner';
import { LocalRunner } from './LocalRunner';
import { BackgroundRunner } from './BackgroundRunner';
import { ChatRunner } from './ChatRunner';
import { Logger } from '../utils/logger';

/**
 * Entry point for launching a Copilot session with task context.
 *
 * Receives a `taskId` and either a `CopilotMode` (legacy) or a GenAI
 * provider `id`, resolves the task from the task registry, builds
 * context via `ContextBuilder`, and delegates to the appropriate runner
 * or `IGenAiProvider`.
 */
export class CopilotLauncher {
  private readonly logger = Logger.getInstance();

  constructor(
    private readonly registry: ProviderRegistry,
    private readonly context: vscode.ExtensionContext,
    private readonly genAiRegistry?: GenAiProviderRegistry,
  ) {}

  async launch(taskId: string, mode: CopilotMode): Promise<void> {
    this.logger.info(`CopilotLauncher: launching ${mode} for task ${taskId}`);

    const task = await this.resolveTask(taskId);
    if (!task) {
      vscode.window.showErrorMessage(`Task "${taskId}" not found.`);
      return;
    }

    const prompt = ContextBuilder.build(task);

    // Try the new GenAI provider registry first
    if (this.genAiRegistry) {
      const provider = this.genAiRegistry.get(mode);
      if (provider) {
        await provider.run(prompt, task);
        return;
      }
    }

    // Fallback to legacy runners for backward compatibility
    switch (mode) {
      case 'cloud':
        await CloudRunner.run(prompt);
        break;
      case 'local':
        await LocalRunner.run(prompt);
        break;
      case 'background':
        await BackgroundRunner.run(task, prompt);
        break;
      case 'chat':
        await ChatRunner.run(prompt);
        break;
    }
  }

  /**
   * Launch using an explicit GenAI provider id (new API).
   */
  async launchWithProvider(taskId: string, providerId: string): Promise<void> {
    this.logger.info(`CopilotLauncher: launching provider "${providerId}" for task ${taskId}`);

    if (!this.genAiRegistry) {
      vscode.window.showErrorMessage('GenAI provider registry is not available.');
      return;
    }

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

    const prompt = ContextBuilder.build(task);
    await provider.run(prompt, task);
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

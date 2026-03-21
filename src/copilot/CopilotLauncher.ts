import * as vscode from 'vscode';
import { KanbanTask } from '../types/KanbanTask';
import { CopilotMode } from '../types/Messages';
import { ProviderRegistry } from '../providers/ProviderRegistry';
import { ContextBuilder } from './ContextBuilder';
import { CloudRunner } from './CloudRunner';
import { LocalRunner } from './LocalRunner';
import { BackgroundRunner } from './BackgroundRunner';
import { Logger } from '../utils/logger';

/**
 * Entry point for launching a Copilot session with task context.
 *
 * Receives a `taskId` and a `CopilotMode`, resolves the task
 * from the registry, builds context via `ContextBuilder`, and
 * delegates to the appropriate runner.
 */
export class CopilotLauncher {
  private readonly logger = Logger.getInstance();

  constructor(
    private readonly registry: ProviderRegistry,
    private readonly context: vscode.ExtensionContext,
  ) {}

  async launch(taskId: string, mode: CopilotMode): Promise<void> {
    this.logger.info(`CopilotLauncher: launching ${mode} for task ${taskId}`);

    const task = await this.resolveTask(taskId);
    if (!task) {
      vscode.window.showErrorMessage(`Task "${taskId}" not found.`);
      return;
    }

    const prompt = ContextBuilder.build(task);

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

import * as vscode from 'vscode';
import { KanbanTask } from '../../types/KanbanTask';
import { Logger } from '../../utils/logger';
import { GenAiProviderConfig, GenAiProviderScope, IGenAiProvider } from '../IGenAiProvider';

/**
 * GenAI provider that runs silently via the VS Code Language Model API.
 *
 * - No sidebar, no terminal, no output channel.
 * - Worktree is always enabled (`supportsWorktree = true`).
 * - `/yolo` is on by default; `/fleet` is configurable.
 * - The task is moved to in-progress by SquadManager.
 */
export class CopilotCliGenAiProvider implements IGenAiProvider {
  readonly id = 'copilot-cli';
  readonly displayName = 'Copilot CLI';
  readonly icon = 'terminal';
  readonly scope: GenAiProviderScope = 'global';
  readonly supportsWorktree = true;

  private readonly yolo: boolean;
  private readonly fleet: boolean;

  constructor(config?: GenAiProviderConfig) {
    this.yolo = config?.yolo ?? true;
    this.fleet = config?.fleet ?? false;
  }

  async isAvailable(): Promise<boolean> {
    return !!(vscode.lm && typeof vscode.lm.selectChatModels === 'function');
  }

  async run(prompt: string, _task?: KanbanTask): Promise<void> {
    const logger = Logger.getInstance();

    const effectivePrompt = this.buildPrompt(prompt);

    const models = await vscode.lm.selectChatModels({ vendor: 'copilot' });
    if (models.length === 0) {
      logger.warn('CopilotCliGenAiProvider: no Copilot model available');
      return;
    }

    const model = models[0];
    const messages = [vscode.LanguageModelChatMessage.User(effectivePrompt)];
    const response = await model.sendRequest(messages);

    // Consume the stream silently
    for await (const _ of response.text) {
      // no-op — background execution
    }

    logger.info('CopilotCliGenAiProvider: completed silently (yolo=%s, fleet=%s)', this.yolo, this.fleet);
  }

  dispose(): void {
    // Nothing to clean up
  }

  private buildPrompt(prompt: string): string {
    const parts: string[] = [];
    if (this.yolo) {
      parts.push('Apply all changes automatically without asking for confirmation.');
    }
    if (this.fleet) {
      parts.push('Focus exclusively on the assigned task, work independently, avoid conflicts with other sessions.');
    }
    if (parts.length > 0) {
      parts.push('');
    }
    parts.push(prompt);
    return parts.join('\n');
  }
}

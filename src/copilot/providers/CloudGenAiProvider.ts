import * as vscode from 'vscode';
import { KanbanTask } from '../../types/KanbanTask';
import { Logger } from '../../utils/logger';
import { GenAiProviderScope, IGenAiProvider } from '../IGenAiProvider';

/**
 * GenAI provider that runs silently via the VS Code Language Model API.
 *
 * - No sidebar, no terminal, no output channel.
 * - Always autopilot.
 * - The task is moved to in-progress by SquadManager.
 *
 * Scope: **global** — integrates with the VS Code Language Model API.
 */
export class CloudGenAiProvider implements IGenAiProvider {
  readonly id = 'cloud';
  readonly displayName = 'Cloud';
  readonly icon = 'cloud';
  readonly scope: GenAiProviderScope = 'global';

  async isAvailable(): Promise<boolean> {
    return !!(vscode.lm && typeof vscode.lm.selectChatModels === 'function');
  }

  async run(prompt: string, _task?: KanbanTask): Promise<void> {
    const logger = Logger.getInstance();

    const effectivePrompt = `Apply all changes automatically without asking for confirmation.\n\n${prompt}`;

    const models = await vscode.lm.selectChatModels({ vendor: 'copilot' });
    if (models.length === 0) {
      logger.warn('CloudGenAiProvider: no Copilot model available');
      return;
    }

    const model = models[0];
    const messages = [vscode.LanguageModelChatMessage.User(effectivePrompt)];
    const response = await model.sendRequest(messages);

    // Consume the stream silently
    for await (const _ of response.text) {
      // no-op — background execution
    }

    logger.info('CloudGenAiProvider: completed silently (autopilot)');
  }

  dispose(): void {
    // Nothing to clean up
  }
}

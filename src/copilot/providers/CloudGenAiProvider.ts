import * as vscode from 'vscode';
import { IGenAiProvider, GenAiProviderScope } from '../IGenAiProvider';
import { Logger } from '../../utils/logger';

/**
 * GenAI provider that uses `vscode.lm.selectChatModels()` to send
 * prompts to the GitHub Copilot cloud model and streams the response
 * into an output channel.
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

  async run(prompt: string): Promise<void> {
    const logger = Logger.getInstance();

    try {
      if (!await this.isAvailable()) {
        vscode.window.showWarningMessage(
          'GitHub Copilot extension is not installed or the Language Model API is not available.',
        );
        return;
      }

      const models = await vscode.lm.selectChatModels({ vendor: 'copilot' });
      if (models.length === 0) {
        vscode.window.showWarningMessage(
          'No Copilot model available. Please ensure GitHub Copilot is installed and signed in.',
        );
        return;
      }

      const model = models[0];
      const messages = [vscode.LanguageModelChatMessage.User(prompt)];
      const response = await model.sendRequest(messages);

      const channel = vscode.window.createOutputChannel('Copilot Response');
      channel.show(true);
      for await (const chunk of response.text) {
        channel.append(chunk);
      }

      logger.info('CloudGenAiProvider: response complete');
    } catch (err) {
      logger.error('CloudGenAiProvider error:', String(err));
      vscode.window.showErrorMessage(`Copilot error: ${err}`);
    }
  }

  dispose(): void {
    // Nothing to clean up
  }
}

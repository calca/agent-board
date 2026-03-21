import * as vscode from 'vscode';
import { Logger } from '../utils/logger';

/**
 * Copilot Cloud runner — uses `vscode.lm.selectChatModels()` to find a
 * Copilot model and opens a chat session with the task context prompt.
 */
export class CloudRunner {
  static async run(prompt: string): Promise<void> {
    const logger = Logger.getInstance();

    try {
      // Check if vscode.lm API is available
      if (!vscode.lm || typeof vscode.lm.selectChatModels !== 'function') {
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

      // Show response in an output channel
      const channel = vscode.window.createOutputChannel('Copilot Response');
      channel.show(true);
      for await (const chunk of response.text) {
        channel.append(chunk);
      }

      logger.info('CloudRunner: response complete');
    } catch (err) {
      logger.error('CloudRunner error:', String(err));
      vscode.window.showErrorMessage(`Copilot error: ${err}`);
    }
  }
}

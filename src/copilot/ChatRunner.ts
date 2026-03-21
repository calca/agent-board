import * as vscode from 'vscode';
import { Logger } from '../utils/logger';

/**
 * Copilot Chat runner — opens the VS Code chat panel with the task
 * context pre-filled as the initial prompt.
 *
 * Uses `workbench.action.chat.open` to launch the native chat UI
 * so the user can interact with Copilot directly.
 *
 * Requires VS Code 1.87+ and GitHub Copilot Chat extension.
 */
export class ChatRunner {
  static async run(prompt: string): Promise<void> {
    const logger = Logger.getInstance();

    try {
      // Open the VS Code chat panel with the task context as pre-filled query.
      // The `query` parameter is supported since VS Code 1.87.
      await vscode.commands.executeCommand('workbench.action.chat.open', {
        query: prompt,
      });

      logger.info('ChatRunner: VS Code chat opened with task context');
    } catch (err) {
      logger.error('ChatRunner error:', String(err));

      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('command') && message.includes('not found')) {
        vscode.window.showErrorMessage(
          'VS Code Chat is not available. Please ensure GitHub Copilot Chat is installed.',
        );
      } else {
        vscode.window.showErrorMessage(`Failed to open VS Code chat: ${message}`);
      }
    }
  }
}

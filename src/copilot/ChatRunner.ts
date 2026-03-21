import * as vscode from 'vscode';
import { Logger } from '../utils/logger';

/**
 * Copilot Chat runner — opens the VS Code chat panel with the task
 * context pre-filled as the initial prompt.
 *
 * Uses `workbench.action.chat.open` to launch the native chat UI
 * so the user can interact with Copilot directly.
 */
export class ChatRunner {
  static async run(prompt: string): Promise<void> {
    const logger = Logger.getInstance();

    try {
      // Open the VS Code chat panel with the task context as pre-filled query
      await vscode.commands.executeCommand('workbench.action.chat.open', {
        query: prompt,
      });

      logger.info('ChatRunner: VS Code chat opened with task context');
    } catch (err) {
      logger.error('ChatRunner error:', String(err));
      vscode.window.showErrorMessage(
        `Could not open VS Code chat: ${err}. Ensure GitHub Copilot Chat is installed.`,
      );
    }
  }
}

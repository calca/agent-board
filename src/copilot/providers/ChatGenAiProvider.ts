import * as vscode from 'vscode';
import { IGenAiProvider, GenAiProviderScope } from '../IGenAiProvider';
import { Logger } from '../../utils/logger';

/**
 * GenAI provider that opens the VS Code native chat panel with the
 * task context pre-filled as the initial prompt.
 *
 * Scope: **global** — integrates with VS Code Chat API.
 * Requires VS Code 1.87+ and GitHub Copilot Chat extension.
 */
export class ChatGenAiProvider implements IGenAiProvider {
  readonly id = 'chat';
  readonly displayName = 'Chat';
  readonly icon = 'comment-discussion';
  readonly scope: GenAiProviderScope = 'global';

  async isAvailable(): Promise<boolean> {
    // Chat command may or may not be present; we assume it is when
    // the Copilot Chat extension is installed.
    const commands = await vscode.commands.getCommands(true);
    return commands.includes('workbench.action.chat.open');
  }

  async run(prompt: string): Promise<void> {
    const logger = Logger.getInstance();

    try {
      await vscode.commands.executeCommand('workbench.action.chat.open', {
        query: prompt,
      });
      logger.info('ChatGenAiProvider: VS Code chat opened with task context');
    } catch (err) {
      logger.error('ChatGenAiProvider error:', String(err));

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

  dispose(): void {
    // Nothing to clean up
  }
}

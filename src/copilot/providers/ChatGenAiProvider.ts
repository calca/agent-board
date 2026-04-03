import * as vscode from 'vscode';
import { KanbanTask } from '../../types/KanbanTask';
import { Logger } from '../../utils/logger';
import { GenAiProviderScope, IGenAiProvider } from '../IGenAiProvider';

/**
 * GenAI provider that opens a **new** VS Code chat session in agent
 * mode with the task title pre-filled as prompt.
 *
 * The prompt is NOT auto-submitted — the developer reviews it and
 * presses Enter manually.
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
    const commands = await vscode.commands.getCommands(true);
    return commands.includes('workbench.action.chat.open');
  }

  async run(prompt: string, task?: KanbanTask): Promise<void> {
    const logger = Logger.getInstance();

    try {
      // Build a concise prompt from the task title (+ description when available).
      const query = this.buildChatQuery(prompt, task);

      // Force a brand-new chat session for every CTA click.
      await vscode.commands.executeCommand('workbench.action.chat.newChat');
      await new Promise(r => setTimeout(r, 300));

      // Open a fresh chat session in agent mode with the query prefilled.
      // isPartialQuery: true  → prefills the input box but does NOT submit.
      await vscode.commands.executeCommand('workbench.action.chat.open', {
        mode: 'autopilot',
        query,
        isPartialQuery: true,
      });

      logger.info('ChatGenAiProvider: new agent chat opened with prefilled prompt');
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

  /** Build a human-readable query from the task. */
  private buildChatQuery(prompt: string, task?: KanbanTask): string {
    if (task) {
      const parts: string[] = [task.title];
      if (task.body?.trim()) {
        parts.push('', task.body.trim());
      }
      return parts.join('\n');
    }
    return prompt;
  }
}

import * as vscode from 'vscode';
import { KanbanTask } from '../../types/KanbanTask';
import { Logger } from '../../utils/logger';
import { GenAiProviderConfig, GenAiProviderScope, IGenAiProvider } from '../IGenAiProvider';

/**
 * GenAI provider that opens a VS Code agent chat session and
 * auto-submits the prompt. The session is visible in VS Code’s
 * Sessions panel.
 *
 * - Worktree is always enabled (`supportsWorktree = true`).
 * - `/yolo` is on by default; `/fleet` is configurable.
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
    const commands = await vscode.commands.getCommands(true);
    return commands.includes('workbench.action.chat.open');
  }

  async run(prompt: string, _task?: KanbanTask): Promise<void> {
    const logger = Logger.getInstance();

    try {
      const effectivePrompt = this.buildPrompt(prompt);

      // Create a new chat session visible in VS Code Sessions panel
      await vscode.commands.executeCommand('workbench.action.chat.newChat');
      await new Promise(r => setTimeout(r, 300));
      await vscode.commands.executeCommand('workbench.action.chat.open', {
        mode: 'autopilot',
        query: effectivePrompt,
        isPartialQuery: false,
      });
      // Hide the chat (secondary sidebar) so it doesn't interrupt the flow
      await vscode.commands.executeCommand('workbench.action.closeAuxiliaryBar');

      logger.info('CopilotCliGenAiProvider: agent session created (yolo=%s, fleet=%s)', this.yolo, this.fleet);
    } catch (err) {
      logger.error('CopilotCliGenAiProvider error:', String(err));
    }
  }

  dispose(): void {}

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

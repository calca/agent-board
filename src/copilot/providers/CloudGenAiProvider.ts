import * as vscode from 'vscode';
import { KanbanTask } from '../../types/KanbanTask';
import { Logger } from '../../utils/logger';
import { GenAiProviderScope, IGenAiProvider } from '../IGenAiProvider';

/**
 * GenAI provider that opens a VS Code agent chat session in autopilot
 * mode and auto-submits. The session is visible in VS Code’s
 * Sessions panel.
 *
 * Scope: **global** — integrates with VS Code Chat API.
 */
export class CloudGenAiProvider implements IGenAiProvider {
  readonly id = 'cloud';
  readonly displayName = 'Cloud';
  readonly icon = 'cloud';
  readonly scope: GenAiProviderScope = 'global';

  async isAvailable(): Promise<boolean> {
    const commands = await vscode.commands.getCommands(true);
    return commands.includes('workbench.action.chat.open');
  }

  async run(prompt: string, _task?: KanbanTask): Promise<void> {
    const logger = Logger.getInstance();

    try {
      const effectivePrompt = `Apply all changes automatically without asking for confirmation.\n\n${prompt}`;

      // Create a new chat session visible in VS Code Sessions panel
      await vscode.commands.executeCommand('workbench.action.chat.newChat');
      await new Promise(r => setTimeout(r, 300));
      await vscode.commands.executeCommand('workbench.action.chat.open', {
        mode: 'autopilot',
        query: effectivePrompt,
        isPartialQuery: false,
      });
      // Refocus editor so the chat panel doesn't steal focus
      await vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup');

      logger.info('CloudGenAiProvider: agent session created (autopilot)');
    } catch (err) {
      logger.error('CloudGenAiProvider error:', String(err));
    }
  }

  dispose(): void {}
}

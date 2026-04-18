import * as vscode from 'vscode';
import { KanbanTask } from '../../types/KanbanTask';
import { Logger } from '../../utils/logger';
import { ChatSessionFactory } from '../ChatSessionFactory';
import { GenAiProviderConfig, GenAiProviderScope, GenAiSettingDescriptor, IGenAiProvider } from '../IGenAiProvider';

/**
 * GenAI provider that opens a VS Code agent chat session in autopilot
 * mode and auto-submits. The session is visible in VS Code’s
 * Sessions panel.
 *
 * Scope: **global** — integrates with VS Code Chat API.
 */
export class CloudGenAiProvider implements IGenAiProvider {
  readonly id = 'github-cloud';
  readonly displayName = 'GitHub Cloud';
  readonly description = 'Autopilot via VS Code agent chat (auto-submits)';
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

      // Create a new independent chat session via the serialised factory.
      await ChatSessionFactory.getInstance().create({
        mode: 'autopilot',
        query: effectivePrompt,
        isPartialQuery: false,
      });

      logger.info('CloudGenAiProvider: agent session created (autopilot)');
    } catch (err) {
      logger.error('CloudGenAiProvider error:', String(err));
    }
  }

  getSettingsDescriptors(): GenAiSettingDescriptor[] { return []; }
  applyConfig(_config: GenAiProviderConfig): void { /* no configurable settings */ }

  dispose(): void {}
}

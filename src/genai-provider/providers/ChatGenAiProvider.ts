import * as vscode from 'vscode';
import { AgentTools } from '../../agent/AgentTools';
import { KanbanTask } from '../../types/KanbanTask';
import { Logger } from '../../utils/logger';
import { ChatSessionFactory } from '../ChatSessionFactory';
import { GenAiProviderConfig, GenAiProviderScope, GenAiSettingDescriptor, IGenAiProvider } from '../IGenAiProvider';

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
  readonly displayName = 'Copilot - chat';
  readonly description = 'VS Code agent chat panel';
  readonly icon = 'comment-discussion';
  readonly scope: GenAiProviderScope = 'global';
  /**
   * Chat is interactive — the human drives progression after launch.
   * SquadManager will move the task to inprogress but won't auto-advance
   * it to done/failed when run() returns.
   */
  readonly disableAutoAdvance = true;

  private agentTools: AgentTools | undefined;

  async isAvailable(): Promise<boolean> {
    const commands = await vscode.commands.getCommands(true);
    return commands.includes('workbench.action.chat.open');
  }

  async run(prompt: string, task?: KanbanTask): Promise<void> {
    const logger = Logger.getInstance();

    // Lazily initialise AgentTools with workspace root
    if (!this.agentTools) {
      const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (root) {
        this.agentTools = new AgentTools(root);
      }
    }

    try {
      // Build a concise prompt from the task title (+ description when available).
      const query = this.buildChatQuery(prompt, task);

      // Create a new independent chat session via the serialised factory.
      await ChatSessionFactory.getInstance().create({
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

  /** Execute a tool call from the model. Falls back gracefully if tools API is unavailable. */
  async handleToolCall(name: string, args: Record<string, unknown>): Promise<string> {
    if (!this.agentTools) {
      return 'Tools not available — no workspace root';
    }
    const result = await this.agentTools.execute(name, args);
    return result.content;
  }

  getSettingsDescriptors(): GenAiSettingDescriptor[] { return []; }
  applyConfig(_config: GenAiProviderConfig): void { /* no configurable settings */ }

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

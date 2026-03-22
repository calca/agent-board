import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { IGenAiProvider, GenAiProviderScope } from '../IGenAiProvider';
import { KanbanTask } from '../../types/KanbanTask';
import { Logger } from '../../utils/logger';

/**
 * GenAI provider that runs GitHub Copilot silently via the VS Code
 * Language Model API and saves the result to a workspace file.
 *
 * Scope: **global** — integrates with the VS Code Language Model API.
 *
 * Output is written to `.kanban-notes/{taskId}.md` and shown in
 * an output channel.
 */
export class CopilotCliGenAiProvider implements IGenAiProvider {
  readonly id = 'copilot-cli';
  readonly displayName = 'Copilot CLI';
  readonly icon = 'terminal';
  readonly scope: GenAiProviderScope = 'global';
  readonly supportsWorktree = true;

  async isAvailable(): Promise<boolean> {
    return !!(vscode.lm && typeof vscode.lm.selectChatModels === 'function');
  }

  async run(prompt: string, task?: KanbanTask): Promise<void> {
    const logger = Logger.getInstance();
    const channel = vscode.window.createOutputChannel('Copilot CLI');

    try {
      let responseText = '';

      if (await this.isAvailable()) {
        const models = await vscode.lm.selectChatModels({ vendor: 'copilot' });
        if (models.length > 0) {
          const model = models[0];
          const messages = [vscode.LanguageModelChatMessage.User(prompt)];
          const response = await model.sendRequest(messages);

          for await (const chunk of response.text) {
            responseText += chunk;
          }
        }
      }

      if (!responseText) {
        responseText = `(Background analysis${task ? ` for task "${task.title}"` : ''} — no model available)`;
      }

      channel.appendLine(responseText);
      channel.show(true);

      // Save to workspace file when a task is provided
      if (task) {
        const folders = vscode.workspace.workspaceFolders;
        if (folders) {
          const notesDir = path.join(folders[0].uri.fsPath, '.kanban-notes');
          if (!fs.existsSync(notesDir)) {
            fs.mkdirSync(notesDir, { recursive: true });
          }

          const safeId = task.id.replace(/[^a-zA-Z0-9_-]/g, '_');
          const filePath = path.join(notesDir, `${safeId}.md`);
          const header = [
            '---',
            `task: "${task.title}"`,
            `id: "${task.id}"`,
            `status: "${task.status}"`,
            `date: "${new Date().toISOString()}"`,
            '---',
            '',
          ].join('\n');

          fs.writeFileSync(filePath, header + responseText, 'utf-8');
          logger.info(`CopilotCliGenAiProvider: saved to ${filePath}`);
        }
      }
    } catch (err) {
      logger.error('CopilotCliGenAiProvider error:', String(err));
      vscode.window.showErrorMessage(`Copilot CLI error: ${err}`);
    }
  }

  dispose(): void {
    // Nothing to clean up
  }
}

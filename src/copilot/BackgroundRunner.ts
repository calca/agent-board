import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { KanbanTask } from '../types/KanbanTask';
import { Logger } from '../utils/logger';

/**
 * Copilot Background runner — runs silently using `vscode.lm.sendRequest()`
 * and saves the result to `.kanban-notes/{taskId}.md` in the workspace.
 */
export class BackgroundRunner {
  static async run(task: KanbanTask, prompt: string): Promise<void> {
    const logger = Logger.getInstance();
    const channel = vscode.window.createOutputChannel('Copilot Background');

    try {
      let responseText = '';

      if (vscode.lm && typeof vscode.lm.selectChatModels === 'function') {
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
        responseText = `(Background analysis for task "${task.title}" — no model available)`;
      }

      // Write to output channel
      channel.appendLine(responseText);
      channel.show(true);

      // Save to workspace file
      const folders = vscode.workspace.workspaceFolders;
      if (folders) {
        const notesDir = path.join(folders[0].uri.fsPath, '.kanban-notes');
        if (!fs.existsSync(notesDir)) {
          fs.mkdirSync(notesDir, { recursive: true });
        }

        const safeId = task.id.replace(/[^a-zA-Z0-9_-]/g, '_');
        const filePath = path.join(notesDir, `${safeId}.md`);
        const header = [
          `---`,
          `task: "${task.title}"`,
          `id: "${task.id}"`,
          `status: "${task.status}"`,
          `date: "${new Date().toISOString()}"`,
          `---`,
          '',
        ].join('\n');

        fs.writeFileSync(filePath, header + responseText, 'utf-8');
        logger.info(`BackgroundRunner: saved to ${filePath}`);
      }
    } catch (err) {
      logger.error('BackgroundRunner error:', String(err));
      vscode.window.showErrorMessage(`Background runner error: ${err}`);
    }
  }
}

import * as vscode from 'vscode';
import { KanbanTask } from '../types/KanbanTask';

/**
 * Builds the system prompt / context string sent to the Copilot model.
 *
 * Includes: task title, body, labels, status, URL, workspace path,
 * open tabs, and selected text in the active editor.
 */
export class ContextBuilder {
  static build(task: KanbanTask): string {
    const parts: string[] = [];

    parts.push(`# Task: ${task.title}`);
    parts.push(`Status: ${task.status}`);

    if (task.labels.length > 0) {
      parts.push(`Labels: ${task.labels.join(', ')}`);
    }

    if (task.assignee) {
      parts.push(`Assignee: ${task.assignee}`);
    }

    if (task.url) {
      parts.push(`Source: ${task.url}`);
    }

    if (task.body) {
      parts.push('');
      parts.push('## Description');
      parts.push(task.body);
    }

    // Workspace info
    const folders = vscode.workspace.workspaceFolders;
    if (folders && folders.length > 0) {
      parts.push('');
      parts.push(`Workspace: ${folders[0].uri.fsPath}`);
    }

    // Active editor selection
    const editor = vscode.window.activeTextEditor;
    if (editor) {
      const selection = editor.selection;
      if (!selection.isEmpty) {
        const text = editor.document.getText(selection);
        parts.push('');
        parts.push('## Selected Code');
        parts.push('```');
        parts.push(text);
        parts.push('```');
      }
    }

    return parts.join('\n');
  }

  /**
   * Build from a configurable template.
   * Replaces `{{variable}}` placeholders. Unknown variables become empty strings.
   */
  static buildFromTemplate(template: string, task: KanbanTask): string {
    const vars: Record<string, string> = {
      title: task.title,
      body: task.body,
      labels: task.labels.join(', '),
      status: task.status,
      assignee: task.assignee ?? '',
      url: task.url ?? '',
      workspace: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '',
    };

    return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => vars[key] ?? '');
  }
}

import { exec } from 'child_process';
import * as vscode from 'vscode';
import { KanbanTask } from '../types/KanbanTask';

/** How much context to inject into the prompt. */
export type ContextDepth = 'minimal' | 'standard' | 'full';

/**
 * Builds the system prompt / context string sent to the Copilot model.
 *
 * Includes: task title, body, labels, status, URL, workspace path,
 * open tabs, and selected text in the active editor.
 *
 * The `contextDepth` setting controls how much metadata is injected:
 * - `minimal` — task info only
 * - `standard` — task + workspace + selection (default)
 * - `full` — standard + file tree + git metadata
 */
export class ContextBuilder {
  /** Read the configured context depth from settings. */
  static getContextDepth(): ContextDepth {
    const setting = vscode.workspace
      .getConfiguration('agentBoard')
      .get<string>('contextDepth', 'standard');
    if (setting === 'minimal' || setting === 'full') {
      return setting;
    }
    return 'standard';
  }

  static build(task: KanbanTask): string {
    const depth = ContextBuilder.getContextDepth();
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

    if (depth === 'minimal') {
      return parts.join('\n');
    }

    // Workspace info (standard + full)
    const folders = vscode.workspace.workspaceFolders;
    if (folders && folders.length > 0) {
      parts.push('');
      parts.push(`Workspace: ${folders[0].uri.fsPath}`);
    }

    // Active editor selection (standard + full)
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
   * Async build that includes full context (file tree + git metadata).
   * Used when `contextDepth` is `full`.
   */
  static async buildFull(task: KanbanTask): Promise<string> {
    const base = ContextBuilder.build(task);
    const depth = ContextBuilder.getContextDepth();

    if (depth !== 'full') {
      return base;
    }

    const parts: string[] = [base];
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!root) {
      return base;
    }

    // File tree (top-level, depth 2)
    const tree = await ContextBuilder.runGit('find . -maxdepth 2 -not -path "./.git/*" -not -path "./node_modules/*" | head -100', root);
    if (tree) {
      parts.push('');
      parts.push('## File Tree');
      parts.push('```');
      parts.push(tree);
      parts.push('```');
    }

    // Git branch + recent commits
    const branch = await ContextBuilder.runGit('git rev-parse --abbrev-ref HEAD', root);
    if (branch) {
      parts.push('');
      parts.push(`Branch: ${branch}`);
    }

    const log = await ContextBuilder.runGit('git log --oneline -5', root);
    if (log) {
      parts.push('');
      parts.push('## Recent Commits');
      parts.push('```');
      parts.push(log);
      parts.push('```');
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

  /** Run a shell command and return trimmed stdout, or empty string on error. */
  private static runGit(cmd: string, cwd: string): Promise<string> {
    return new Promise(resolve => {
      exec(cmd, { cwd, timeout: 5_000 }, (err, stdout) => {
        if (err) { resolve(''); return; }
        resolve(stdout.trim());
      });
    });
  }
}

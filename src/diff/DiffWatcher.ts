import { exec } from 'child_process';
import * as path from 'path';
import * as vscode from 'vscode';
import { Logger } from '../utils/logger';

export interface FileChange {
  path: string;
  status: 'added' | 'modified' | 'deleted';
}

/**
 * Watches a worktree (or the workspace root) for file changes.
 *
 * Uses a combination of:
 * - `vscode.workspace.createFileSystemWatcher` for real-time events
 * - `git diff --name-status HEAD` for a snapshot of changes vs HEAD
 *
 * A debounce timer prevents rapid-fire events from flooding the listener.
 */
export class DiffWatcher implements vscode.Disposable {
  private readonly logger = Logger.getInstance();
  private readonly watcher: vscode.FileSystemWatcher;
  private debounceTimer: ReturnType<typeof setTimeout> | undefined;

  private readonly _onDidChange = new vscode.EventEmitter<FileChange[]>();
  /** Fires (debounced) whenever the set of changed files changes. */
  readonly onDidChange: vscode.Event<FileChange[]> = this._onDidChange.event;

  private latestChanges: FileChange[] = [];

  constructor(
    readonly rootPath: string,
    private readonly debounceMs: number = 500,
  ) {
    const pattern = new vscode.RelativePattern(rootPath, '**/*');
    this.watcher = vscode.workspace.createFileSystemWatcher(pattern);

    const trigger = () => this.scheduleRefresh();
    this.watcher.onDidCreate(trigger);
    this.watcher.onDidChange(trigger);
    this.watcher.onDidDelete(trigger);
  }

  /** Manually trigger a diff refresh (e.g. after a git commit). */
  async refresh(): Promise<FileChange[]> {
    this.latestChanges = await this.gitDiff();
    this._onDidChange.fire(this.latestChanges);
    return this.latestChanges;
  }

  /** Return the last-known set of changed files. */
  getChanges(): FileChange[] {
    return this.latestChanges;
  }

  /** Open the VS Code diff editor for a single file (HEAD vs working tree). */
  async openDiff(filePath: string): Promise<void> {
    const absPath = path.join(this.rootPath, filePath);
    // Build the git HEAD URI using VS Code's built-in git extension URI scheme
    const headUri = vscode.Uri.file(absPath).with({
      scheme: 'git',
      query: JSON.stringify({ path: absPath, ref: 'HEAD' }),
    });
    const workingUri = vscode.Uri.file(absPath);
    await vscode.commands.executeCommand('vscode.diff', headUri, workingUri, `${filePath} (HEAD ↔ Working)`);
  }

  /**
   * Open a multi-file diff showing all changed files vs HEAD.
   * Uses `vscode.changes` (VS Code 1.87+); falls back to SCM view otherwise.
   */
  async openFullDiff(files: FileChange[]): Promise<void> {
    if (files.length === 0) {
      await vscode.commands.executeCommand('workbench.view.scm');
      return;
    }
    // vscode.changes expects [labelUri, leftUri?, rightUri?]
    const resources: [vscode.Uri, vscode.Uri, vscode.Uri][] = files
      .filter(f => f.status !== 'deleted')
      .map(f => {
        const absPath = path.join(this.rootPath, f.path);
        const headUri = vscode.Uri.file(absPath).with({
          scheme: 'git',
          query: JSON.stringify({ path: absPath, ref: 'HEAD' }),
        });
        return [vscode.Uri.file(absPath), headUri, vscode.Uri.file(absPath)] as [vscode.Uri, vscode.Uri, vscode.Uri];
      });
    // Deleted files: HEAD → empty
    for (const f of files.filter(d => d.status === 'deleted')) {
      const absPath = path.join(this.rootPath, f.path);
      const headUri = vscode.Uri.file(absPath).with({
        scheme: 'git',
        query: JSON.stringify({ path: absPath, ref: 'HEAD' }),
      });
      const emptyUri = vscode.Uri.file(absPath).with({
        scheme: 'git',
        query: JSON.stringify({ path: absPath, ref: '' }),
      });
      resources.push([vscode.Uri.file(absPath), headUri, emptyUri]);
    }
    try {
      await vscode.commands.executeCommand('vscode.changes', 'Worktree Diff', resources);
    } catch {
      // Fallback for VS Code < 1.87
      await vscode.commands.executeCommand('workbench.view.scm');
    }
  }

  dispose(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.watcher.dispose();
    this._onDidChange.dispose();
  }

  // ── private ──────────────────────────────────────────────────────

  private scheduleRefresh(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => void this.refresh(), this.debounceMs);
  }

  private gitDiff(): Promise<FileChange[]> {
    return new Promise<FileChange[]>(resolve => {
      exec(
        'git diff --name-status HEAD',
        { cwd: this.rootPath, timeout: 10_000 },
        (err, stdout) => {
          if (err) {
            this.logger.warn('DiffWatcher: git diff failed:', err.message);
            resolve([]);
            return;
          }
          const changes: FileChange[] = [];
          for (const line of stdout.trim().split('\n')) {
            if (!line) { continue; }
            const [statusChar, ...pathParts] = line.split('\t');
            const path = pathParts.join('\t');
            if (!path) { continue; }
            let status: FileChange['status'] = 'modified';
            if (statusChar === 'A') { status = 'added'; }
            else if (statusChar === 'D') { status = 'deleted'; }
            changes.push({ path, status });
          }
          resolve(changes);
        },
      );
    });
  }
}

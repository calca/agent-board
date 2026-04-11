import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { ProjectConfig } from '../config/ProjectConfig';
import { KanbanTask } from '../types/KanbanTask';
import { ITaskProvider, ProviderConfigField, ProviderDiagnostic } from './ITaskProvider';

/**
 * Task provider backed by Markdown files in an inbox directory.
 *
 * Each `.md` file becomes one task:
 *  - **Title** — filename without the `.md` extension.
 *  - **Body**  — full content of the file.
 *
 * When a task's status is updated to `done` the corresponding `.md`
 * file is moved to a configurable `donePath` directory.
 *
 * Default paths (workspace-relative):
 *  - inbox: `.agent-board/markdown/inbox`
 *  - done:  `.agent-board/markdown/done`
 */
export class MarkdownProvider implements ITaskProvider {
  readonly id = 'markdown';
  readonly displayName = 'Markdown';
  readonly icon = 'markdown';

  private readonly _onDidChangeTasks = new vscode.EventEmitter<KanbanTask[]>();
  readonly onDidChangeTasks = this._onDidChangeTasks.event;

  private watcher: vscode.FileSystemWatcher | undefined;
  private inboxDir = '';
  private doneDir = '';
  private tasks: KanbanTask[] = [];
  private loaded = false;

  constructor() {
    this.readConfig();
    this.setupWatcher();
  }

  async getTasks(): Promise<KanbanTask[]> {
    if (!this.loaded) {
      await this.loadFromDisk();
    }
    return this.tasks;
  }

  async updateTask(task: KanbanTask): Promise<void> {
    const index = this.tasks.findIndex(t => t.id === task.id);
    if (index !== -1) {
      this.tasks[index] = task;
    }

    // Move the file to the done directory when the task is marked as done.
    if (task.status === 'done' && this.inboxDir && this.doneDir) {
      const nativeId = task.id.replace(`${this.id}:`, '');
      const srcPath = path.join(this.inboxDir, `${nativeId}.md`);
      if (fs.existsSync(srcPath)) {
        try {
          fs.mkdirSync(this.doneDir, { recursive: true });
          fs.renameSync(srcPath, path.join(this.doneDir, `${nativeId}.md`));
          // Remove from local cache — the file watcher will also detect the deletion
          this.tasks = this.tasks.filter(t => t.id !== task.id);
        } catch {
          // Best-effort move — status update is still applied in memory
        }
      }
    }

    this._onDidChangeTasks.fire(this.tasks);
  }

  async refresh(): Promise<void> {
    this.readConfig();
    this.loaded = false;
    this.setupWatcher();
    await this.loadFromDisk();
    this._onDidChangeTasks.fire(this.tasks);
  }

  dispose(): void {
    this.watcher?.dispose();
    this._onDidChangeTasks.dispose();
  }

  // ── Configuration & diagnostics ──────────────────────────────────────

  getConfigFields(): ProviderConfigField[] {
    return [
      {
        key: 'inboxPath',
        label: 'Inbox directory',
        type: 'string',
        placeholder: '.agent-board/markdown/inbox',
        hint: 'Relative to workspace root — place .md files here to create tasks',
      },
      {
        key: 'donePath',
        label: 'Done directory',
        type: 'string',
        placeholder: '.agent-board/markdown/done',
        hint: 'Relative to workspace root — done .md files are moved here',
      },
    ];
  }

  async diagnose(): Promise<ProviderDiagnostic> {
    if (!this.inboxDir) {
      return { severity: 'error', message: 'No workspace folder open.' };
    }
    try {
      fs.accessSync(this.inboxDir, fs.constants.W_OK);
      return { severity: 'ok', message: 'Markdown inbox directory is writable.' };
    } catch {
      return {
        severity: 'warning',
        message: `Inbox directory does not exist yet (${this.inboxDir}). It will be created automatically.`,
      };
    }
  }

  isEnabled(): boolean {
    const cfg = ProjectConfig.getProjectConfig();
    return cfg?.markdownProvider?.enabled === true;
  }

  // ── private ──────────────────────────────────────────────────────────

  private readConfig(): void {
    const projectCfg = ProjectConfig.getProjectConfig();
    this.inboxDir = this.resolvePath(
      projectCfg?.markdownProvider?.inboxPath,
      'markdownProvider.inboxPath',
      '.agent-board/markdown/inbox',
    );
    this.doneDir = this.resolvePath(
      projectCfg?.markdownProvider?.donePath,
      'markdownProvider.donePath',
      '.agent-board/markdown/done',
    );
  }

  private resolvePath(fileValue: string | undefined, settingKey: string, defaultValue: string): string {
    const raw = ProjectConfig.resolve(fileValue, settingKey, defaultValue);
    if (!raw) { return ''; }
    if (path.isAbsolute(raw)) { return raw; }
    const folders = vscode.workspace.workspaceFolders;
    return folders ? path.join(folders[0].uri.fsPath, raw) : '';
  }

  private setupWatcher(): void {
    this.watcher?.dispose();
    if (!this.inboxDir) { return; }
    const glob = path.join(this.inboxDir, '**', '*.md');
    this.watcher = vscode.workspace.createFileSystemWatcher(glob);
    const reload = () => {
      this.loaded = false;
      this.loadFromDisk().then(() => this._onDidChangeTasks.fire(this.tasks));
    };
    this.watcher.onDidChange(reload);
    this.watcher.onDidCreate(reload);
    this.watcher.onDidDelete(reload);
  }

  private async loadFromDisk(): Promise<void> {
    this.loaded = true;
    if (!this.inboxDir) {
      this.tasks = [];
      return;
    }
    try {
      fs.mkdirSync(this.inboxDir, { recursive: true });
    } catch {
      // ignore
    }
    try {
      const files = fs.readdirSync(this.inboxDir).filter(f => f.endsWith('.md'));
      this.tasks = files
        .map(file => {
          try {
            const content = fs.readFileSync(path.join(this.inboxDir, file), 'utf-8');
            return this.mapFile(file, content);
          } catch {
            return null;
          }
        })
        .filter((t): t is KanbanTask => t !== null);
    } catch {
      this.tasks = [];
    }
  }

  private mapFile(filename: string, content: string): KanbanTask {
    const nativeId = filename.slice(0, -3); // strip .md
    const title = nativeId.replace(/[-_]/g, ' ');
    return {
      id: `${this.id}:${nativeId}`,
      title,
      body: content,
      status: 'todo',
      labels: [],
      providerId: this.id,
      meta: {},
    };
  }
}

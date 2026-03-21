import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { ITaskProvider } from './ITaskProvider';
import { KanbanTask } from '../types/KanbanTask';
import { ColumnId, COLUMN_IDS } from '../types/ColumnId';

/** Schema for a single task entry in the JSON file. */
interface JsonTaskEntry {
  id: string;
  title: string;
  body?: string;
  status?: string;
  labels?: string[];
  assignee?: string;
  url?: string;
  createdAt?: string;
  [key: string]: unknown;
}

/**
 * Task provider backed by a local JSON file.
 *
 * Watches the file with `vscode.workspace.createFileSystemWatcher`
 * and reloads automatically when it changes.
 */
export class JsonProvider implements ITaskProvider {
  readonly id = 'json';
  readonly displayName = 'JSON File';
  readonly icon = 'file-code';

  private readonly _onDidChangeTasks = new vscode.EventEmitter<KanbanTask[]>();
  readonly onDidChangeTasks = this._onDidChangeTasks.event;

  private watcher: vscode.FileSystemWatcher | undefined;
  private filePath = '';
  private tasks: KanbanTask[] = [];

  constructor() {
    this.readConfig();
    this.setupWatcher();
  }

  async getTasks(): Promise<KanbanTask[]> {
    if (this.tasks.length === 0) {
      await this.loadFromDisk();
    }
    return this.tasks;
  }

  async updateTask(task: KanbanTask): Promise<void> {
    const index = this.tasks.findIndex(t => t.id === task.id);
    if (index !== -1) {
      this.tasks[index] = task;
    }
    await this.saveToDisk();
  }

  async refresh(): Promise<void> {
    this.readConfig();
    this.setupWatcher();
    await this.loadFromDisk();
    this._onDidChangeTasks.fire(this.tasks);
  }

  dispose(): void {
    this.watcher?.dispose();
    this._onDidChangeTasks.dispose();
  }

  // ── private ─────────────────────────────────────────────────────────

  private readConfig(): void {
    const cfg = vscode.workspace.getConfiguration('agentBoard');
    const raw = cfg.get<string>('jsonProvider.path', '');
    if (!raw) {
      this.filePath = '';
      return;
    }
    if (path.isAbsolute(raw)) {
      this.filePath = raw;
    } else {
      const folders = vscode.workspace.workspaceFolders;
      this.filePath = folders ? path.join(folders[0].uri.fsPath, raw) : raw;
    }
  }

  private setupWatcher(): void {
    this.watcher?.dispose();
    if (!this.filePath) {
      return;
    }
    this.watcher = vscode.workspace.createFileSystemWatcher(this.filePath);
    const reload = () => {
      this.loadFromDisk().then(() => this._onDidChangeTasks.fire(this.tasks));
    };
    this.watcher.onDidChange(reload);
    this.watcher.onDidCreate(reload);
    this.watcher.onDidDelete(() => {
      this.tasks = [];
      this._onDidChangeTasks.fire(this.tasks);
    });
  }

  private async loadFromDisk(): Promise<void> {
    if (!this.filePath) {
      this.tasks = [];
      return;
    }
    try {
      const raw = fs.readFileSync(this.filePath, 'utf-8');
      const parsed = JSON.parse(raw);
      const entries: JsonTaskEntry[] = Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsed.tasks)
          ? parsed.tasks
          : [];
      this.tasks = entries.map(e => this.mapEntry(e));
    } catch {
      vscode.window.showErrorMessage(`JSON Provider: failed to read "${this.filePath}".`);
      this.tasks = [];
    }
  }

  private async saveToDisk(): Promise<void> {
    if (!this.filePath) {
      return;
    }
    const entries = this.tasks.map(t => this.toEntry(t));
    fs.writeFileSync(this.filePath, JSON.stringify(entries, null, 2), 'utf-8');
  }

  private mapEntry(entry: JsonTaskEntry): KanbanTask {
    return {
      id: `${this.id}:${entry.id}`,
      title: entry.title ?? 'Untitled',
      body: entry.body ?? '',
      status: this.normalizeStatus(entry.status),
      labels: entry.labels ?? [],
      assignee: entry.assignee,
      url: entry.url,
      providerId: this.id,
      createdAt: entry.createdAt ? new Date(entry.createdAt) : undefined,
      meta: entry as unknown as Record<string, unknown>,
    };
  }

  private toEntry(task: KanbanTask): JsonTaskEntry {
    return {
      id: task.id.replace(`${this.id}:`, ''),
      title: task.title,
      body: task.body,
      status: task.status,
      labels: task.labels,
      assignee: task.assignee,
      url: task.url,
      createdAt: task.createdAt?.toISOString(),
    };
  }

  private normalizeStatus(raw?: string): ColumnId {
    if (raw && (COLUMN_IDS as readonly string[]).includes(raw)) {
      return raw as ColumnId;
    }
    return 'todo';
  }
}

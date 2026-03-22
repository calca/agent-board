import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { ITaskProvider } from './ITaskProvider';
import { KanbanTask } from '../types/KanbanTask';
import { ColumnId, COLUMN_IDS } from '../types/ColumnId';
import { ProjectConfig } from '../config/ProjectConfig';

/** Shape of a single task file on disk. */
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
 * Task provider backed by one JSON file per task under a directory.
 *
 * Default directory: `.agent-board/tasks/`
 * Each task is stored as `<nativeId>.json` within that directory.
 * A `FileSystemWatcher` on `<dir>/**\/*.json` keeps the in-memory
 * cache in sync with any external edits.
 */
export class JsonProvider implements ITaskProvider {
  readonly id = 'json';
  readonly displayName = 'Tasks';
  readonly icon = 'tasklist';

  private readonly _onDidChangeTasks = new vscode.EventEmitter<KanbanTask[]>();
  readonly onDidChangeTasks = this._onDidChangeTasks.event;

  private watcher: vscode.FileSystemWatcher | undefined;
  /** Absolute path to the tasks directory. Empty when no workspace is open. */
  private tasksDir = '';
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
    await this.writeTaskFile(task);
    this._onDidChangeTasks.fire(this.tasks);
  }

  async createTask(title: string, description?: string): Promise<KanbanTask> {
    if (!this.loaded) {
      await this.loadFromDisk();
    }
    const nativeId = `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const task: KanbanTask = {
      id: `${this.id}:${nativeId}`,
      title,
      body: description ?? '',
      status: 'todo',
      labels: [],
      providerId: this.id,
      createdAt: new Date(),
      meta: {},
    };
    this.tasks.push(task);
    await this.writeTaskFile(task);
    this._onDidChangeTasks.fire(this.tasks);
    return task;
  }

  async deleteTaskById(compositeId: string): Promise<boolean> {
    const index = this.tasks.findIndex(t => t.id === compositeId);
    if (index === -1) { return false; }
    const [task] = this.tasks.splice(index, 1);
    this.deleteTaskFile(task);
    this._onDidChangeTasks.fire(this.tasks);
    return true;
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

  // ── private ──────────────────────────────────────────────────────────

  private readConfig(): void {
    const projectCfg = ProjectConfig.getProjectConfig();
    const raw = ProjectConfig.resolve(
      projectCfg?.jsonProvider?.path,
      'jsonProvider.path',
      '.agent-board/tasks',
    );
    if (!raw) {
      this.tasksDir = '';
      return;
    }
    // Strip a trailing .json extension — the config used to point at a single file
    const dirPath = raw.endsWith('.json') ? raw.slice(0, -5) : raw;
    if (path.isAbsolute(dirPath)) {
      this.tasksDir = dirPath;
    } else {
      const folders = vscode.workspace.workspaceFolders;
      this.tasksDir = folders ? path.join(folders[0].uri.fsPath, dirPath) : '';
    }
  }

  private setupWatcher(): void {
    this.watcher?.dispose();
    if (!this.tasksDir) { return; }
    // Watch all .json files inside the directory
    const glob = path.join(this.tasksDir, '**', '*.json');
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
    if (!this.tasksDir) {
      this.tasks = [];
      return;
    }
    try {
      fs.mkdirSync(this.tasksDir, { recursive: true });
    } catch {
      // ignore
    }
    try {
      const files = fs.readdirSync(this.tasksDir).filter(f => f.endsWith('.json'));
      this.tasks = files
        .map(file => {
          try {
            const raw = fs.readFileSync(path.join(this.tasksDir, file), 'utf-8');
            return this.mapEntry(JSON.parse(raw) as JsonTaskEntry);
          } catch {
            return null;
          }
        })
        .filter((t): t is KanbanTask => t !== null)
        .sort((a, b) => (a.createdAt?.getTime() ?? 0) - (b.createdAt?.getTime() ?? 0));
    } catch {
      this.tasks = [];
    }
  }

  private async writeTaskFile(task: KanbanTask): Promise<void> {
    if (!this.tasksDir) { return; }
    fs.mkdirSync(this.tasksDir, { recursive: true });
    const nativeId = task.id.replace(`${this.id}:`, '');
    const filePath = path.join(this.tasksDir, `${nativeId}.json`);
    const entry = this.toEntry(task);
    fs.writeFileSync(filePath, JSON.stringify(entry, null, 2), 'utf-8');
  }

  private deleteTaskFile(task: KanbanTask): void {
    if (!this.tasksDir) { return; }
    const nativeId = task.id.replace(`${this.id}:`, '');
    const filePath = path.join(this.tasksDir, `${nativeId}.json`);
    try { fs.unlinkSync(filePath); } catch { /* already gone */ }
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

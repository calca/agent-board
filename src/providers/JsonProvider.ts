import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { ProjectConfig } from '../config/ProjectConfig';
import { ColumnId, FIRST_COLUMN } from '../types/ColumnId';
import { KanbanTask } from '../types/KanbanTask';
import { Logger } from '../utils/logger';
import { ITaskProvider, ProviderConfigField, ProviderDiagnostic } from './ITaskProvider';

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
  agent?: string;
  hidden?: boolean;
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
      nativeId,
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
    Logger.getInstance().info('JsonProvider: created task %s', task.id);
    return task;
  }

  async deleteTaskById(compositeId: string): Promise<boolean> {
    const index = this.tasks.findIndex(t => t.id === compositeId);
    if (index === -1) { return false; }
    const [task] = this.tasks.splice(index, 1);
    this.deleteTaskFile(task);
    this._onDidChangeTasks.fire(this.tasks);
    Logger.getInstance().info('JsonProvider: deleted task %s', compositeId);
    return true;
  }

  /** Mark a task as hidden so it no longer appears on the board. */
  async hideTask(compositeId: string): Promise<boolean> {
    const task = this.tasks.find(t => t.id === compositeId);
    if (!task) { return false; }
    (task.meta as Record<string, unknown>).hidden = true;
    await this.writeTaskFile(task);
    this.tasks = this.tasks.filter(t => t.id !== compositeId);
    this._onDidChangeTasks.fire(this.tasks);
    return true;
  }

  async refresh(): Promise<void> {
    this.readConfig();
    this.loaded = false;
    this.setupWatcher();
    await this.loadFromDisk();
    Logger.getInstance().debug('JsonProvider: refreshed, %d task(s)', this.tasks.length);
    this._onDidChangeTasks.fire(this.tasks);
  }

  dispose(): void {
    this.watcher?.dispose();
    this._onDidChangeTasks.dispose();
  }

  // ── Configuration & diagnostics ──────────────────────────────────────

  getConfigFields(): ProviderConfigField[] {
    return [
      { key: 'path', label: 'Tasks directory', type: 'string', placeholder: '.agent-board/tasks', hint: 'Relative to workspace root' },
    ];
  }

  async diagnose(): Promise<ProviderDiagnostic> {
    if (!this.tasksDir) {
      return { severity: 'error', message: 'No workspace folder open.' };
    }
    try {
      fs.accessSync(this.tasksDir, fs.constants.W_OK);
      return { severity: 'ok', message: 'Tasks directory is writable.' };
    } catch {
      return { severity: 'warning', message: `Tasks directory does not exist yet (${this.tasksDir}). It will be created on first task.` };
    }
  }

  isEnabled(): boolean {
    const cfg = ProjectConfig.getProjectConfig();
    return cfg?.jsonProvider?.enabled !== false;
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
      const parsed: { file: string; task: KanbanTask }[] = [];
      for (const file of files) {
        try {
          const raw = fs.readFileSync(path.join(this.tasksDir, file), 'utf-8');
          const entry = JSON.parse(raw) as JsonTaskEntry;
          if (entry.hidden) { continue; }
          parsed.push({ file, task: this.mapEntry(entry) });
        } catch {
          // skip malformed files
        }
      }

      // Deduplicate by internal id — when two files share the same id,
      // keep the canonical one (filename matches nativeId) and delete the stale orphan.
      const byId = new Map<string, { file: string; task: KanbanTask }>();
      const orphans: string[] = [];
      for (const item of parsed) {
        const existing = byId.get(item.task.id);
        if (!existing) {
          byId.set(item.task.id, item);
          continue;
        }
        // Prefer the file whose name matches the internal nativeId
        const canonicalName = `${item.task.nativeId}.json`;
        if (item.file === canonicalName) {
          orphans.push(existing.file);
          byId.set(item.task.id, item);
        } else {
          orphans.push(item.file);
        }
      }

      // Clean up stale orphan files
      for (const orphan of orphans) {
        try {
          fs.unlinkSync(path.join(this.tasksDir, orphan));
          Logger.getInstance().info('JsonProvider: removed orphan task file %s', orphan);
        } catch { /* best effort */ }
      }

      this.tasks = [...byId.values()]
        .map(v => v.task)
        .sort((a, b) => (a.createdAt?.getTime() ?? 0) - (b.createdAt?.getTime() ?? 0));
    } catch {
      this.tasks = [];
    }
  }

  private async writeTaskFile(task: KanbanTask): Promise<void> {
    if (!this.tasksDir) { return; }
    fs.mkdirSync(this.tasksDir, { recursive: true });
    const filePath = path.join(this.tasksDir, `${task.nativeId}.json`);
    const entry = this.toEntry(task);
    fs.writeFileSync(filePath, JSON.stringify(entry, null, 2), 'utf-8');
  }

  private deleteTaskFile(task: KanbanTask): void {
    if (!this.tasksDir) { return; }
    const filePath = path.join(this.tasksDir, `${task.nativeId}.json`);
    try { fs.unlinkSync(filePath); } catch { /* already gone */ }
  }

  private mapEntry(entry: JsonTaskEntry): KanbanTask {
    return {
      id: `${this.id}:${entry.id}`,
      nativeId: entry.id,
      title: entry.title ?? 'Untitled',
      body: entry.body ?? '',
      status: this.normalizeStatus(entry.status),
      labels: entry.labels ?? [],
      assignee: entry.assignee,
      url: entry.url,
      agent: entry.agent,
      providerId: this.id,
      createdAt: entry.createdAt ? new Date(entry.createdAt) : undefined,
      meta: entry as unknown as Record<string, unknown>,
    };
  }

  private toEntry(task: KanbanTask): JsonTaskEntry {
    const entry: JsonTaskEntry = {
      id: task.nativeId,
      title: task.title,
      body: task.body,
      status: task.status,
      labels: task.labels,
      assignee: task.assignee,
      url: task.url,
      agent: task.agent,
      createdAt: task.createdAt?.toISOString(),
    };
    if ((task.meta as Record<string, unknown>)?.hidden) {
      entry.hidden = true;
    }
    return entry;
  }

  private normalizeStatus(raw?: string): ColumnId {
    // Accept any string — columns are configurable.
    return raw ?? FIRST_COLUMN;
  }
}

import * as vscode from 'vscode';
import { TaskStore } from '../taskStore';
import { Task } from '../types';
import { KanbanTask } from '../types/KanbanTask';
import { ITaskProvider, ProviderConfigField, ProviderDiagnostic } from './ITaskProvider';

/**
 * Exposes the internal `TaskStore` (workspace-state tasks) as a `ITaskProvider`
 * so they appear on the Kanban board alongside other providers.
 */
export class TaskStoreProvider implements ITaskProvider {
  readonly id = 'taskstore';
  readonly displayName = 'Local Tasks';
  readonly icon = 'tasklist';

  private readonly _onDidChangeTasks = new vscode.EventEmitter<KanbanTask[]>();
  readonly onDidChangeTasks = this._onDidChangeTasks.event;

  constructor(private readonly store: TaskStore) {}

  async getTasks(): Promise<KanbanTask[]> {
    return this.store.getTasks().map(t => this.toKanban(t));
  }

  async updateTask(task: KanbanTask): Promise<void> {
    const nativeId = task.id.replace(/^taskstore:/, '');
    const status = task.status === 'done' ? 'completed' : 'pending';
    this.store.updateTask(nativeId, { status });
    this._onDidChangeTasks.fire(await this.getTasks());
  }

  async deleteTaskById(compositeId: string): Promise<boolean> {
    const nativeId = compositeId.replace(/^taskstore:/, '');
    const ok = this.store.deleteTask(nativeId);
    if (ok) { this._onDidChangeTasks.fire(await this.getTasks()); }
    return ok;
  }

  async refresh(): Promise<void> {
    this._onDidChangeTasks.fire(await this.getTasks());
  }

  /** Call this after externally mutating the store so the Kanban panel updates. */
  notifyChanged(): void {
    void this.getTasks().then(tasks => this._onDidChangeTasks.fire(tasks));
  }

  dispose(): void {
    this._onDidChangeTasks.dispose();
  }

  // ── Configuration & diagnostics ──────────────────────────────────────

  getConfigFields(): ProviderConfigField[] {
    return []; // No user-facing config
  }

  async diagnose(): Promise<ProviderDiagnostic> {
    return { severity: 'ok', message: 'Local task store is always available.' };
  }

  isEnabled(): boolean {
    return true; // Built-in, always enabled
  }

  // ── private ─────────────────────────────────────────────────────────

  private toKanban(task: Task): KanbanTask {
    const status = task.status === 'completed' ? 'done' : 'todo';
    return {
      id: `taskstore:${task.id}`,
      title: task.title,
      body: task.description ?? '',
      status,
      labels: [],
      providerId: this.id,
      createdAt: task.createdAt ? new Date(task.createdAt) : undefined,
      meta: {},
    };
  }
}

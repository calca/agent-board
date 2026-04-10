import * as vscode from 'vscode';
import { KanbanTask } from '../types/KanbanTask';
import { ITaskProvider, ProviderConfigField, ProviderDiagnostic } from './ITaskProvider';

/**
 * Aggregates tasks from multiple `ITaskProvider` instances.
 *
 * - Deduplicates by composite `id` (which is globally unique by design).
 * - Isolates individual provider failures so one broken provider
 *   does not block the rest.
 * - Fires `onDidChangeTasks` whenever any child provider fires.
 */
export class AggregatorProvider implements ITaskProvider {
  readonly id = 'aggregator';
  readonly displayName = 'All Providers';
  readonly icon = 'layers';

  private readonly _onDidChangeTasks = new vscode.EventEmitter<KanbanTask[]>();
  readonly onDidChangeTasks = this._onDidChangeTasks.event;

  private readonly subscriptions: vscode.Disposable[] = [];

  constructor(private readonly providers: ITaskProvider[]) {
    for (const p of providers) {
      const sub = p.onDidChangeTasks(() => {
        this.emitAggregated();
      });
      this.subscriptions.push(sub);
    }
  }

  async getTasks(): Promise<KanbanTask[]> {
    const results = await Promise.allSettled(
      this.providers.map(p => p.getTasks()),
    );

    const seen = new Set<string>();
    const tasks: KanbanTask[] = [];

    for (const result of results) {
      if (result.status === 'fulfilled') {
        for (const task of result.value) {
          if (!seen.has(task.id)) {
            seen.add(task.id);
            tasks.push(task);
          }
        }
      }
      // rejected providers are silently skipped
    }

    return tasks;
  }

  async updateTask(task: KanbanTask): Promise<void> {
    const provider = this.providers.find(p => p.id === task.providerId);
    if (provider) {
      await provider.updateTask(task);
    }
  }

  async refresh(): Promise<void> {
    await Promise.allSettled(this.providers.map(p => p.refresh()));
    await this.emitAggregated();
  }

  dispose(): void {
    for (const sub of this.subscriptions) {
      sub.dispose();
    }
    this._onDidChangeTasks.dispose();
  }

  // ── Configuration & diagnostics ──────────────────────────────────────

  getConfigFields(): ProviderConfigField[] {
    return []; // Aggregator has no own config
  }

  async diagnose(): Promise<ProviderDiagnostic> {
    return { severity: 'ok', message: 'Aggregator delegates to child providers.' };
  }

  isEnabled(): boolean {
    return true; // Always enabled
  }

  // ── private ─────────────────────────────────────────────────────────

  private async emitAggregated(): Promise<void> {
    const tasks = await this.getTasks();
    this._onDidChangeTasks.fire(tasks);
  }
}

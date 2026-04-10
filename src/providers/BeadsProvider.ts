import * as vscode from 'vscode';
import { ProjectConfig } from '../config/ProjectConfig';
import { ColumnId } from '../types/ColumnId';
import { KanbanTask } from '../types/KanbanTask';
import { execShell, execShellOk } from './execShell';
import { ITaskProvider, ProviderConfigField, ProviderDiagnostic } from './ITaskProvider';

interface BeadsIssue {
  id: string | number;
  title: string;
  description?: string;
  state?: string;
  tags?: string[];
  [key: string]: unknown;
}

/**
 * Task provider backed by the **Beads** CLI.
 *
 * Runs `beads list --format=json`, parses stdout, maps to `KanbanTask[]`.
 * Polls on a configurable interval.
 */
export class BeadsProvider implements ITaskProvider {
  readonly id = 'beads';
  readonly displayName = 'Beads';
  readonly icon = 'beaker';

  private readonly _onDidChangeTasks = new vscode.EventEmitter<KanbanTask[]>();
  readonly onDidChangeTasks = this._onDidChangeTasks.event;

  private tasks: KanbanTask[] = [];
  private timer: ReturnType<typeof setInterval> | undefined;
  private executable = 'beads';
  private onlyAssignedToMe = false;
  private pollIntervalMs = 30_000;

  constructor() {
    this.readConfig();
    if (this.isEnabled()) { this.startPolling(); }
  }

  async getTasks(): Promise<KanbanTask[]> {
    if (!this.isEnabled()) { return []; }
    if (this.tasks.length === 0) {
      await this.fetchTasks();
    }
    return this.tasks;
  }

  async updateTask(task: KanbanTask): Promise<void> {
    // Update local status immediately (Beads CLI doesn't support remote writes)
    const idx = this.tasks.findIndex(t => t.id === task.id);
    if (idx !== -1) {
      this.tasks[idx] = { ...this.tasks[idx], status: task.status };
      this._onDidChangeTasks.fire(this.tasks);
    }
  }

  async removeDoneTask(id: string): Promise<void> {
    this.tasks = this.tasks.filter(t => t.id !== id);
    this._onDidChangeTasks.fire(this.tasks);
  }

  async refresh(): Promise<void> {
    this.readConfig();
    if (!this.isEnabled()) {
      if (this.timer) { clearInterval(this.timer); this.timer = undefined; }
      this.tasks = [];
      this._onDidChangeTasks.fire(this.tasks);
      return;
    }
    if (!this.timer) { this.startPolling(); }
    await this.fetchTasks();
    this._onDidChangeTasks.fire(this.tasks);
  }

  dispose(): void {
    if (this.timer) { clearInterval(this.timer); }
    this._onDidChangeTasks.dispose();
  }

  // ── Configuration & diagnostics ──────────────────────────────────────

  getConfigFields(): ProviderConfigField[] {
    return [
      { key: 'executable', label: 'Beads executable', type: 'string', placeholder: 'beads', hint: 'Path or command name' },
      { key: 'onlyAssignedToMe', label: 'Only items assigned to me', type: 'boolean' },
    ];
  }

  async diagnose(): Promise<ProviderDiagnostic> {
    this.readConfig();
    const ok = await execShellOk(this.executable, ['--version'], { timeout: 5_000 });
    if (!ok) {
      return { severity: 'error', message: `Beads binary not found (${this.executable}). Install beads or set the correct path.` };
    }
    return { severity: 'ok', message: `Beads CLI available (${this.executable}).` };
  }

  isEnabled(): boolean {
    const cfg = ProjectConfig.getProjectConfig();
    return cfg?.beadsProvider?.enabled === true;
  }

  // ── private ─────────────────────────────────────────────────────────

  private readConfig(): void {
    const projectCfg = ProjectConfig.getProjectConfig();
    this.executable = ProjectConfig.resolve(
      projectCfg?.beadsProvider?.executable,
      'beadsProvider.executable',
      'beads',
    );
    this.pollIntervalMs = ProjectConfig.resolve(
      projectCfg?.pollInterval,
      'pollInterval',
      30_000,
    );
    this.onlyAssignedToMe = projectCfg?.beadsProvider?.onlyAssignedToMe === true;
  }

  private startPolling(): void {
    if (this.timer) {
      clearInterval(this.timer);
    }
    this.timer = setInterval(async () => {
      try {
        await this.fetchTasks();
        this._onDidChangeTasks.fire(this.tasks);
      } catch {
        // polling errors are non-fatal
      }
    }, this.pollIntervalMs);
  }

  private async fetchTasks(): Promise<void> {
    try {
      const args = ['list', '--format=json'];
      if (this.onlyAssignedToMe) { args.push('--assignee', '@me'); }
      const { stdout } = await execShell(this.executable, args, { timeout: 15_000 });
      try {
        const raw: BeadsIssue[] = JSON.parse(stdout);
        const newTasks = raw.map(issue => this.mapBeadsToTask(issue));
        // Preserve local status overrides — but respect remote terminal states (done)
        const oldStatusMap = new Map(this.tasks.map(t => [t.id, t.status]));
        for (const t of newTasks) {
          if (t.status === 'done') { continue; } // remote terminal state wins
          const oldStatus = oldStatusMap.get(t.id);
          if (oldStatus && oldStatus !== t.status) { t.status = oldStatus; }
        }
        this.tasks = newTasks;
      } catch {
        vscode.window.showWarningMessage('Beads CLI: failed to parse output.');
      }
    } catch (err) {
      vscode.window.showWarningMessage(`Beads CLI error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /** Single point of contact with the Beads schema. */
  private mapBeadsToTask(raw: BeadsIssue): KanbanTask {
    return {
      id: `${this.id}:${raw.id}`,
      title: raw.title,
      body: raw.description ?? '',
      status: this.mapStatus(raw.state),
      labels: raw.tags ?? [],
      providerId: this.id,
      meta: { ...(raw as unknown as Record<string, unknown>), remoteStatus: raw.state ?? 'unknown' },
    };
  }

  private mapStatus(state?: string): ColumnId {
    switch (state?.toLowerCase()) {
      case 'done':
      case 'closed':
      case 'completed':
        return 'done';
      case 'in_progress':
      case 'inprogress':
      case 'wip':
        return 'inprogress';
      case 'review':
        return 'review';
      default:
        return 'todo';
    }
  }
}

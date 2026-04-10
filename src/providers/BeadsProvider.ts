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
  private pollIntervalMs = 30_000;

  constructor() {
    this.readConfig();
    this.startPolling();
  }

  async getTasks(): Promise<KanbanTask[]> {
    if (this.tasks.length === 0) {
      await this.fetchTasks();
    }
    return this.tasks;
  }

  async updateTask(_task: KanbanTask): Promise<void> {
    // Beads CLI doesn't support updating via this path — noop
    vscode.window.showWarningMessage('Beads provider does not support inline task updates.');
  }

  async refresh(): Promise<void> {
    this.readConfig();
    await this.fetchTasks();
    this._onDidChangeTasks.fire(this.tasks);
  }

  dispose(): void {
    if (this.timer) {
      clearInterval(this.timer);
    }
    this._onDidChangeTasks.dispose();
  }

  // ── Configuration & diagnostics ──────────────────────────────────────

  getConfigFields(): ProviderConfigField[] {
    return [
      { key: 'executable', label: 'Beads executable', type: 'string', placeholder: 'beads', hint: 'Path or command name' },
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
      const { stdout } = await execShell(this.executable, ['list', '--format=json'], { timeout: 15_000 });
      try {
        const raw: BeadsIssue[] = JSON.parse(stdout);
        this.tasks = raw.map(issue => this.mapBeadsToTask(issue));
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
      meta: raw as unknown as Record<string, unknown>,
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

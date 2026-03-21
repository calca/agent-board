import * as vscode from 'vscode';
import { execFile } from 'child_process';
import { ITaskProvider } from './ITaskProvider';
import { KanbanTask } from '../types/KanbanTask';
import { ColumnId } from '../types/ColumnId';

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

  // ── private ─────────────────────────────────────────────────────────

  private readConfig(): void {
    const cfg = vscode.workspace.getConfiguration('agentBoard');
    this.executable = cfg.get<string>('beadsProvider.executable', 'beads');
    this.pollIntervalMs = cfg.get<number>('pollInterval', 30_000);
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

  private fetchTasks(): Promise<void> {
    return new Promise((resolve) => {
      execFile(this.executable, ['list', '--format=json'], { timeout: 15_000 }, (err, stdout) => {
        if (err) {
          vscode.window.showWarningMessage(`Beads CLI error: ${err.message}`);
          resolve();
          return;
        }
        try {
          const raw: BeadsIssue[] = JSON.parse(stdout);
          this.tasks = raw.map(issue => this.mapBeadsToTask(issue));
        } catch {
          vscode.window.showWarningMessage('Beads CLI: failed to parse output.');
        }
        resolve();
      });
    });
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

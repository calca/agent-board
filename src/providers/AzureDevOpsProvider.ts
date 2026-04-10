import { execFile } from 'child_process';
import * as vscode from 'vscode';
import { ProjectConfig } from '../config/ProjectConfig';
import { ColumnId } from '../types/ColumnId';
import { KanbanTask } from '../types/KanbanTask';
import { ITaskProvider, ProviderConfigField, ProviderDiagnostic } from './ITaskProvider';

interface AzWorkItem {
  id: number;
  fields: {
    'System.Title'?: string;
    'System.Description'?: string;
    'System.State'?: string;
    'System.Tags'?: string;
    'System.AssignedTo'?: { displayName?: string; uniqueName?: string };
    'System.CreatedDate'?: string;
    [key: string]: unknown;
  };
  url?: string;
}

/**
 * Task provider backed by the **Azure DevOps CLI** (`az boards`).
 *
 * Requires the Azure CLI with the `azure-devops` extension installed.
 * Runs `az boards work-item list` and maps work items to `KanbanTask[]`.
 * Polls on a configurable interval.
 */
export class AzureDevOpsProvider implements ITaskProvider {
  readonly id = 'azure-devops';
  readonly displayName = 'Azure DevOps';
  readonly icon = 'azure';

  private readonly _onDidChangeTasks = new vscode.EventEmitter<KanbanTask[]>();
  readonly onDidChangeTasks = this._onDidChangeTasks.event;

  private tasks: KanbanTask[] = [];
  private timer: ReturnType<typeof setInterval> | undefined;
  private organization = '';
  private project = '';
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

  async updateTask(task: KanbanTask): Promise<void> {
    const nativeId = task.id.replace(`${this.id}:`, '');
    const state = this.reverseMapStatus(task.status);
    return new Promise((resolve, reject) => {
      const args = [
        'boards', 'work-item', 'update',
        '--id', nativeId,
        '--state', state,
        '--output', 'json',
      ];
      if (this.organization) { args.push('--org', this.organization); }
      execFile('az', args, { timeout: 15_000 }, (err) => {
        if (err) {
          reject(new Error(`Azure DevOps CLI error: ${err.message}`));
        } else {
          void this.refresh();
          resolve();
        }
      });
    });
  }

  async refresh(): Promise<void> {
    this.readConfig();
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
      { key: 'organization', label: 'Organization', type: 'string', placeholder: 'https://dev.azure.com/my-org', required: true, hint: 'Organization URL or name' },
      { key: 'project', label: 'Project', type: 'string', placeholder: 'e.g. MyProject', required: true },
    ];
  }

  async diagnose(): Promise<ProviderDiagnostic> {
    // Check az CLI availability
    const azOk = await new Promise<boolean>((resolve) => {
      execFile('az', ['--version'], { timeout: 5_000 }, (err) => resolve(!err));
    });
    if (!azOk) {
      return { severity: 'error', message: 'Azure CLI (az) not found. Install it from https://aka.ms/installazurecli.' };
    }

    // Check azure-devops extension
    const devopsOk = await new Promise<boolean>((resolve) => {
      execFile('az', ['extension', 'show', '--name', 'azure-devops', '--output', 'json'], { timeout: 5_000 }, (err) => resolve(!err));
    });
    if (!devopsOk) {
      return { severity: 'error', message: 'Azure DevOps CLI extension not installed. Run: az extension add --name azure-devops' };
    }

    if (!this.organization || !this.project) {
      return { severity: 'error', message: 'Organization / Project not configured.' };
    }

    return { severity: 'ok', message: `Connected to ${this.organization} / ${this.project}.` };
  }

  isEnabled(): boolean {
    const cfg = ProjectConfig.getProjectConfig();
    return cfg?.azureDevOps?.enabled === true; // opt-in, disabled by default
  }

  // ── private ─────────────────────────────────────────────────────────

  private readConfig(): void {
    const projectCfg = ProjectConfig.getProjectConfig();
    this.organization = ProjectConfig.resolve(
      projectCfg?.azureDevOps?.organization,
      'azureDevOps.organization',
      '',
    );
    this.project = ProjectConfig.resolve(
      projectCfg?.azureDevOps?.project,
      'azureDevOps.project',
      '',
    );
    this.pollIntervalMs = ProjectConfig.resolve(
      projectCfg?.pollInterval,
      'pollInterval',
      30_000,
    );
  }

  private startPolling(): void {
    if (this.timer) { clearInterval(this.timer); }
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
    if (!this.organization || !this.project) {
      this.tasks = [];
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      // WIQL query: all non-removed work items assigned to the project
      const wiql = `SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = '${this.project.replace(/'/g, "''")}' AND [System.State] <> 'Removed' ORDER BY [System.CreatedDate] DESC`;

      const args = [
        'boards', 'query',
        '--wiql', wiql,
        '--org', this.organization,
        '--output', 'json',
      ];

      execFile('az', args, { timeout: 30_000 }, (err, stdout) => {
        if (err) {
          vscode.window.showWarningMessage(`Azure DevOps CLI error: ${err.message}`);
          resolve();
          return;
        }
        try {
          const raw = JSON.parse(stdout) as AzWorkItem[];
          this.tasks = raw.map(item => this.mapWorkItem(item));
        } catch {
          // Query returns IDs only; need to fetch details
          this.fetchWorkItemDetails(stdout).then(resolve).catch(() => resolve());
          return;
        }
        resolve();
      });
    });
  }

  /**
   * When `az boards query` returns only IDs, fetch full work item details.
   */
  private fetchWorkItemDetails(queryOutput: string): Promise<void> {
    return new Promise((resolve) => {
      let ids: number[];
      try {
        const parsed = JSON.parse(queryOutput);
        // az boards query returns { workItems: [{ id: N }] } or an array
        const items = parsed.workItems ?? parsed;
        ids = (items as Array<{ id: number }>).map(w => w.id);
      } catch {
        this.tasks = [];
        resolve();
        return;
      }

      if (ids.length === 0) {
        this.tasks = [];
        resolve();
        return;
      }

      // Fetch in batches of 200
      const batch = ids.slice(0, 200).join(',');
      const args = [
        'boards', 'work-item', 'show',
        '--ids', batch,
        '--org', this.organization,
        '--output', 'json',
      ];

      execFile('az', args, { timeout: 30_000 }, (err, stdout) => {
        if (err) {
          vscode.window.showWarningMessage(`Azure DevOps: failed to fetch work items.`);
          resolve();
          return;
        }
        try {
          const items: AzWorkItem[] = JSON.parse(stdout);
          const itemsArray = Array.isArray(items) ? items : [items];
          this.tasks = itemsArray.map(item => this.mapWorkItem(item));
        } catch {
          vscode.window.showWarningMessage('Azure DevOps: failed to parse work items.');
        }
        resolve();
      });
    });
  }

  private mapWorkItem(item: AzWorkItem): KanbanTask {
    const fields = item.fields ?? {};
    const assignee = fields['System.AssignedTo'];
    const tags = fields['System.Tags'];
    return {
      id: `${this.id}:${item.id}`,
      title: fields['System.Title'] ?? `#${item.id}`,
      body: fields['System.Description'] ?? '',
      status: this.mapStatus(fields['System.State']),
      labels: tags ? tags.split(';').map(t => t.trim()).filter(Boolean) : [],
      assignee: assignee?.displayName ?? assignee?.uniqueName,
      url: item.url,
      providerId: this.id,
      createdAt: fields['System.CreatedDate'] ? new Date(fields['System.CreatedDate'] as string) : undefined,
      meta: fields as unknown as Record<string, unknown>,
    };
  }

  private mapStatus(state?: string): ColumnId {
    switch (state?.toLowerCase()) {
      case 'done':
      case 'closed':
      case 'completed':
      case 'resolved':
        return 'done';
      case 'active':
      case 'in progress':
      case 'committed':
        return 'inprogress';
      case 'review':
        return 'review';
      default:
        return 'todo';
    }
  }

  private reverseMapStatus(column: ColumnId): string {
    switch (column) {
      case 'done': return 'Done';
      case 'inprogress': return 'Active';
      case 'review': return 'Review';
      default: return 'New';
    }
  }
}

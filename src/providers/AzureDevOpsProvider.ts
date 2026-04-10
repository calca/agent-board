import * as vscode from 'vscode';
import { ProjectConfig } from '../config/ProjectConfig';
import { ColumnId } from '../types/ColumnId';
import { KanbanTask } from '../types/KanbanTask';
import { execShell, execShellOk } from './execShell';
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
    const nativeId = task.id.replace(`${this.id}:`, '');
    const state = this.reverseMapStatus(task.status);
    const args = [
      'boards', 'work-item', 'update',
      '--id', nativeId,
      '--state', state,
      '--output', 'json',
    ];
    if (this.organization) { args.push('--org', this.organization); }
    try {
      await execShell('az', args, { timeout: 15_000 });
      void this.refresh();
    } catch (err) {
      throw new Error(`Azure DevOps CLI error: ${err instanceof Error ? err.message : String(err)}`);
    }
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
      { key: 'organization', label: 'Organization', type: 'string', placeholder: 'https://dev.azure.com/my-org', required: true, hint: 'Organization URL or name' },
      { key: 'project', label: 'Project', type: 'string', placeholder: 'e.g. MyProject', required: true },
      { key: 'onlyAssignedToMe', label: 'Only items assigned to me', type: 'boolean' },
    ];
  }

  async diagnose(): Promise<ProviderDiagnostic> {
    this.readConfig();
    // Check az CLI availability
    const azOk = await execShellOk('az', ['--version'], { timeout: 5_000 });
    if (!azOk) {
      return { severity: 'error', message: 'Azure CLI (az) not found. Install: brew install azure-cli' };
    }

    // Check azure-devops extension
    const devopsOk = await execShellOk('az', ['extension', 'show', '--name', 'azure-devops', '--output', 'json'], { timeout: 5_000 });
    if (!devopsOk) {
      return { severity: 'error', message: 'Azure DevOps CLI extension missing. Install: az extension add --name azure-devops' };
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
    this.onlyAssignedToMe = projectCfg?.azureDevOps?.onlyAssignedToMe === true;
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

  private async fetchTasks(): Promise<void> {
    if (!this.organization || !this.project) {
      this.tasks = [];
      return Promise.resolve();
    }

    let wiql = `SELECT [System.Id], [System.Title], [System.Description], [System.State], [System.Tags], [System.AssignedTo], [System.CreatedDate] FROM WorkItems WHERE [System.TeamProject] = '${this.project.replace(/'/g, "''")}' AND [System.State] = 'Active'`;
    if (this.onlyAssignedToMe) {
      wiql += ` AND [System.AssignedTo] = @Me`;
    }
    wiql += ` ORDER BY [System.CreatedDate] DESC`;
    const args = [
      'boards', 'query',
      '--wiql', wiql,
      '--org', this.organization,
      '--output', 'json',
    ];
    try {
      const { stdout } = await execShell('az', args, { timeout: 30_000 });
      // az boards query returns only IDs; always fetch full details for description etc.
      await this.fetchWorkItemDetails(stdout);
    } catch (err) {
      vscode.window.showWarningMessage(`Azure DevOps CLI error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * When `az boards query` returns only IDs, fetch full work item details.
   */
  private async fetchWorkItemDetails(queryOutput: string): Promise<void> {
    let ids: number[];
    try {
      const parsed = JSON.parse(queryOutput);
      // az boards query may return { workItems: [{ id }] }, [{ id }], or [{ fields: { 'System.Id': N } }]
      const items = parsed.workItems ?? parsed;
      ids = (items as Array<Record<string, unknown>>).map(w => {
        if (typeof w.id === 'number') { return w.id; }
        // Some formats nest the id in fields
        const fields = w.fields as Record<string, unknown> | undefined;
        return Number(fields?.['System.Id'] ?? w.id);
      }).filter(n => !isNaN(n));
    } catch {
      this.tasks = [];
      return;
    }

    if (ids.length === 0) {
      this.tasks = [];
      return;
    }

    // az boards work-item show accepts only --id (singular), fetch each item
    const results: AzWorkItem[] = [];
    for (const id of ids.slice(0, 200)) {
      try {
        const { stdout } = await execShell('az', [
          'boards', 'work-item', 'show',
          '--id', String(id),
          '--org', this.organization,
          '--output', 'json',
        ], { timeout: 15_000 });
        const item = JSON.parse(stdout) as AzWorkItem;
        results.push(item);
      } catch {
        // skip items that fail individually
      }
    }
    this.tasks = results.map(item => this.mapWorkItem(item));
  }

  private mapWorkItem(item: AzWorkItem): KanbanTask {
    const fields = item.fields ?? {};
    const assignee = fields['System.AssignedTo'];
    const tags = fields['System.Tags'];
    return {
      id: `${this.id}:${item.id}`,
      title: fields['System.Title'] ?? `#${item.id}`,
      body: fields['System.Description']
        ?? (fields['Microsoft.VSTS.TCM.ReproSteps'] as string | undefined)
        ?? '',
      status: this.mapStatus(fields['System.State']),
      labels: tags ? tags.split(';').map(t => t.trim()).filter(Boolean) : [],
      assignee: assignee?.displayName ?? assignee?.uniqueName,
      url: `${this.organization.replace(/\/+$/, '')}/${encodeURIComponent(this.project)}/_workitems/edit/${item.id}`,
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
      case 'in progress':
      case 'committed':
        return 'inprogress';
      case 'review':
        return 'review';
      case 'active':
      case 'new':
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

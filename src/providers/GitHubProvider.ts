import * as vscode from 'vscode';
import { ITaskProvider } from './ITaskProvider';
import { KanbanTask } from '../types/KanbanTask';
import { ColumnId } from '../types/ColumnId';

interface GitHubIssue {
  number: number;
  title: string;
  body: string | null;
  state: string;
  labels: Array<{ name: string }>;
  assignee: { login: string } | null;
  html_url: string;
  created_at: string;
  [key: string]: unknown;
}

interface GitHubApiOptions {
  owner: string;
  repo: string;
  token: string;
  perPage?: number;
  cacheTtlMs?: number;
}

/**
 * Task provider backed by GitHub Issues (REST API).
 *
 * Auth is read from VSCode SecretStorage (preferred) or the
 * `agentBoard.github.token` setting as fallback.
 */
export class GitHubProvider implements ITaskProvider {
  readonly id = 'github';
  readonly displayName = 'GitHub Issues';
  readonly icon = 'github';

  private readonly _onDidChangeTasks = new vscode.EventEmitter<KanbanTask[]>();
  readonly onDidChangeTasks = this._onDidChangeTasks.event;

  private cache: KanbanTask[] = [];
  private cacheTimestamp = 0;

  private owner = '';
  private repo = '';
  private token = '';
  private perPage = 100;
  private cacheTtlMs = 60_000;

  constructor(private readonly context: vscode.ExtensionContext) {
    this.readConfig();
  }

  async getTasks(): Promise<KanbanTask[]> {
    if (this.isCacheValid()) {
      return this.cache;
    }
    return this.fetchTasks();
  }

  async updateTask(task: KanbanTask): Promise<void> {
    if (!this.token) {
      throw new Error('GitHub token not configured');
    }

    const nativeId = task.id.replace(`${this.id}:`, '');
    const state = task.status === 'done' ? 'closed' : 'open';

    const res = await fetch(
      `https://api.github.com/repos/${this.owner}/${this.repo}/issues/${nativeId}`,
      {
        method: 'PATCH',
        headers: this.headers(),
        body: JSON.stringify({ state }),
      },
    );

    if (!res.ok) {
      throw new Error(`GitHub API error: ${res.status} ${res.statusText}`);
    }

    await this.refresh();
  }

  async refresh(): Promise<void> {
    this.readConfig();
    this.cacheTimestamp = 0;
    const tasks = await this.fetchTasks();
    this._onDidChangeTasks.fire(tasks);
  }

  dispose(): void {
    this._onDidChangeTasks.dispose();
  }

  // ── private ─────────────────────────────────────────────────────────

  private readConfig(): void {
    const cfg = vscode.workspace.getConfiguration('agentBoard');
    this.token = cfg.get<string>('github.token', '');
    this.owner = cfg.get<string>('github.owner', '');
    this.repo = cfg.get<string>('github.repo', '');
    this.cacheTtlMs = 60_000;
  }

  private isCacheValid(): boolean {
    return this.cache.length > 0 && Date.now() - this.cacheTimestamp < this.cacheTtlMs;
  }

  private async fetchTasks(): Promise<KanbanTask[]> {
    if (!this.token || !this.owner || !this.repo) {
      return [];
    }

    const issues: GitHubIssue[] = [];
    let page = 1;
    const maxPages = 5; // up to 500 issues

    while (page <= maxPages) {
      const url = `https://api.github.com/repos/${this.owner}/${this.repo}/issues?state=all&per_page=${this.perPage}&page=${page}`;
      const res = await fetch(url, { headers: this.headers() });

      if (!res.ok) {
        throw new Error(`GitHub API error: ${res.status} ${res.statusText}`);
      }

      const batch = (await res.json()) as GitHubIssue[];
      issues.push(...batch);

      if (batch.length < this.perPage) {
        break;
      }
      page++;
    }

    this.cache = issues.map(issue => this.mapIssue(issue));
    this.cacheTimestamp = Date.now();
    return this.cache;
  }

  private mapIssue(issue: GitHubIssue): KanbanTask {
    return {
      id: `${this.id}:${issue.number}`,
      title: issue.title,
      body: issue.body ?? '',
      status: this.mapStatus(issue.state, issue.labels),
      labels: issue.labels.map(l => l.name),
      assignee: issue.assignee?.login,
      url: issue.html_url,
      providerId: this.id,
      createdAt: new Date(issue.created_at),
      meta: issue as unknown as Record<string, unknown>,
    };
  }

  private mapStatus(state: string, labels: Array<{ name: string }>): ColumnId {
    if (state === 'closed') {
      return 'done';
    }
    const labelNames = labels.map(l => l.name.toLowerCase());
    if (labelNames.includes('in progress') || labelNames.includes('wip')) {
      return 'inprogress';
    }
    if (labelNames.includes('review') || labelNames.includes('needs review')) {
      return 'review';
    }
    return 'todo';
  }

  private headers(): Record<string, string> {
    return {
      'Accept': 'application/vnd.github+json',
      'Authorization': `Bearer ${this.token}`,
      'X-GitHub-Api-Version': '2022-11-28',
    };
  }
}

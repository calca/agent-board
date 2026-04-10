import * as vscode from 'vscode';
import { ProjectConfig } from '../config/ProjectConfig';
import { GitHubIssueManager } from '../github/GitHubIssueManager';
import { ColumnId } from '../types/ColumnId';
import { KanbanTask } from '../types/KanbanTask';
import { execShell, execShellOk } from './execShell';
import { ITaskProvider, ProviderConfigField, ProviderDiagnostic } from './ITaskProvider';

export interface GitHubIssue {
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

/**
 * Task provider backed by GitHub Issues.
 *
 * Uses the **`gh` CLI** when available (preferred), falling back to the
 * GitHub REST API via VS Code's built-in SSO token.
 *
 * Repository coordinates (`owner`/`repo`) are resolved in order:
 *   1. `.agent-board/config.json`
 *   2. VS Code settings (`agentBoard.github.owner` / `.repo`)
 *   3. `gh repo view --json owner,name` (auto-detect from working directory)
 *   4. For `owner` only: the GitHub SSO account login name
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
  private onlyAssignedToMe = false;
  /** `true` after we confirmed `gh` is available. */
  private ghCliAvailable: boolean | undefined;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly issueManager?: GitHubIssueManager,
  ) {
    this.readConfig();
  }

  async getTasks(): Promise<KanbanTask[]> {
    if (this.isCacheValid()) {
      return this.cache;
    }
    return this.fetchTasks();
  }

  async updateTask(task: KanbanTask): Promise<void> {
    // Always update local cache immediately
    const idx = this.cache.findIndex(t => t.id === task.id);
    if (idx !== -1) {
      this.cache[idx] = { ...this.cache[idx], status: task.status };
      this._onDidChangeTasks.fire(this.cache);
    }

    // Fire-and-forget remote sync
    const nativeId = task.id.replace(`${this.id}:`, '');
    const issueNumber = parseInt(nativeId, 10);
    const state = task.status === 'done' ? 'closed' : 'open';

    const syncRemote = async () => {
      if (await this.hasGhCli()) {
        const repoSlug = `${this.owner}/${this.repo}`;
        if (state === 'closed') {
          await this.execGh(['issue', 'close', nativeId, '--repo', repoSlug]);
        } else {
          await this.execGh(['issue', 'reopen', nativeId, '--repo', repoSlug]);
        }
      } else {
        await this.ensureToken();
        if (!this.token) { return; }
        const res = await fetch(
          `https://api.github.com/repos/${this.owner}/${this.repo}/issues/${nativeId}`,
          {
            method: 'PATCH',
            headers: this.apiHeaders(),
            body: JSON.stringify({ state }),
          },
        );
        if (!res.ok) { return; }
      }

      // Sync kanban column label
      if (!isNaN(issueNumber) && this.issueManager) {
        await this.issueManager.syncIssueColumn(issueNumber, task.status).catch(() => { /* non-fatal */ });
      }
    };
    void syncRemote().catch(() => { /* non-fatal: local status already updated */ });
  }

  async removeDoneTask(id: string): Promise<void> {
    this.cache = this.cache.filter(t => t.id !== id);
    this._onDidChangeTasks.fire(this.cache);
  }

  async refresh(): Promise<void> {
    this.readConfig();
    this.cacheTimestamp = 0;
    const tasks = await this.fetchTasks();
    this._onDidChangeTasks.fire(tasks);
  }

  /**
   * Post a markdown summary comment on an issue after agent completion.
   */
  async postAgentSummary(issueNumber: number, summary: string): Promise<void> {
    if (await this.hasGhCli()) {
      if (!this.owner || !this.repo) { return; }
      await this.execGh([
        'issue', 'comment', String(issueNumber),
        '--repo', `${this.owner}/${this.repo}`,
        '--body', summary,
      ]);
      return;
    }

    await this.ensureToken();
    if (!this.token || !this.owner || !this.repo) { return; }

    const res = await fetch(
      `https://api.github.com/repos/${this.owner}/${this.repo}/issues/${issueNumber}/comments`,
      {
        method: 'POST',
        headers: this.apiHeaders(),
        body: JSON.stringify({ body: summary }),
      },
    );
    if (!res.ok) {
      throw new Error(`GitHub API error posting comment: ${res.status} ${res.statusText}`);
    }
  }

  dispose(): void {
    this._onDidChangeTasks.dispose();
  }

  // ── Configuration & diagnostics ──────────────────────────────────────

  getConfigFields(): ProviderConfigField[] {
    return [
      { key: 'owner', label: 'Owner', type: 'string', placeholder: 'e.g. my-org', hint: 'Auto-detected from gh CLI if empty' },
      { key: 'repo', label: 'Repository', type: 'string', placeholder: 'e.g. my-repo', hint: 'Auto-detected from gh CLI if empty' },
      { key: 'onlyAssignedToMe', label: 'Only issues assigned to me', type: 'boolean' },
    ];
  }

  async diagnose(): Promise<ProviderDiagnostic> {
    this.readConfig();
    // Check gh CLI first (preferred)
    if (await this.hasGhCli()) {
      // Verify auth status
      const authOk = await execShellOk('gh', ['auth', 'status'], { timeout: 5_000 });
      if (!authOk) {
        return { severity: 'error', message: 'gh CLI found but not authenticated. Run: gh auth login' };
      }

      // Auto-detect repo if not configured
      if (!this.owner || !this.repo) {
        const detected = await this.detectRepoFromGh();
        if (!detected) {
          return { severity: 'warning', message: 'gh CLI authenticated, but owner/repo not configured and not inside a GitHub repo.' };
        }
      }

      return { severity: 'ok', message: `gh CLI → ${this.owner}/${this.repo}` };
    }

    // Fallback: VS Code SSO
    try {
      const session = await vscode.authentication.getSession('github', ['repo'], { createIfNone: false });
      if (!session) {
        return { severity: 'error', message: 'Neither gh CLI nor GitHub SSO available. Install gh (https://cli.github.com) or sign in via Accounts.' };
      }
    } catch {
      return { severity: 'error', message: 'Neither gh CLI nor GitHub SSO available.' };
    }

    if (!this.owner || !this.repo) {
      return { severity: 'error', message: 'Owner / Repository not configured. Install gh CLI for auto-detection.' };
    }

    return { severity: 'ok', message: `SSO → ${this.owner}/${this.repo}` };
  }

  isEnabled(): boolean {
    const cfg = ProjectConfig.getProjectConfig();
    return cfg?.github?.enabled === true;
  }

  // ── private — gh CLI helpers ────────────────────────────────────────

  /** Check (and cache) whether `gh` is on PATH. */
  private async hasGhCli(): Promise<boolean> {
    if (this.ghCliAvailable !== undefined) { return this.ghCliAvailable; }
    this.ghCliAvailable = await execShellOk('gh', ['--version'], { timeout: 5_000 });
    return this.ghCliAvailable;
  }

  /** Run a `gh` command and return stdout. Throws on non-zero exit. */
  private async execGh(args: string[]): Promise<string> {
    const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const { stdout } = await execShell('gh', args, { timeout: 30_000, cwd });
    return stdout;
  }

  /**
   * Auto-detect `owner/repo` from the current git remote via `gh repo view`.
   * Returns `true` if successful.
   */
  private async detectRepoFromGh(): Promise<boolean> {
    try {
      const stdout = await this.execGh(['repo', 'view', '--json', 'owner,name']);
      const parsed = JSON.parse(stdout) as { owner: { login: string }; name: string };
      if (parsed.owner?.login && parsed.name) {
        this.owner = parsed.owner.login;
        this.repo = parsed.name;
        return true;
      }
    } catch {
      // not inside a gh repo or gh failed
    }
    return false;
  }

  // ── private — config & token ────────────────────────────────────────

  private readConfig(): void {
    const ghCfg = ProjectConfig.getGitHubConfig();
    this.owner = ghCfg.owner;
    this.repo = ghCfg.repo;
    this.cacheTtlMs = 60_000;
    this.onlyAssignedToMe = ProjectConfig.getProjectConfig()?.github?.onlyAssignedToMe === true;
  }

  /** Obtain a token via VS Code's built-in GitHub SSO (REST API fallback). */
  private async ensureToken(): Promise<void> {
    if (this.token) { return; }
    try {
      const session = await vscode.authentication.getSession('github', ['repo'], { createIfNone: false });
      if (session) { this.token = session.accessToken; }
    } catch {
      // SSO not available
    }
  }

  private isCacheValid(): boolean {
    return this.cache.length > 0 && Date.now() - this.cacheTimestamp < this.cacheTtlMs;
  }

  // ── private — fetching ──────────────────────────────────────────────

  private async fetchTasks(): Promise<KanbanTask[]> {
    // Try gh CLI first
    if (await this.hasGhCli()) {
      return this.fetchTasksViaGh();
    }
    // Fallback to REST API
    return this.fetchTasksViaApi();
  }

  /** Fetch issues using `gh issue list --json …`. */
  private async fetchTasksViaGh(): Promise<KanbanTask[]> {
    // Auto-detect repo from working directory if not configured
    if (!this.owner || !this.repo) {
      await this.detectRepoFromGh();
    }
    if (!this.owner || !this.repo) { return []; }

    const repoSlug = `${this.owner}/${this.repo}`;
    const fields = 'number,title,body,state,labels,assignees,url,createdAt';
    const assigneeArgs = this.onlyAssignedToMe ? ['--assignee', '@me'] : [];

    try {
      // Fetch open + closed issues
      const [openStdout, closedStdout] = await Promise.all([
        this.execGh(['issue', 'list', '--repo', repoSlug, '--state', 'open',
          '--limit', '200', '--json', fields, ...assigneeArgs]),
        this.execGh(['issue', 'list', '--repo', repoSlug, '--state', 'closed',
          '--limit', '100', '--json', fields, ...assigneeArgs]),
      ]);

      const openIssues = JSON.parse(openStdout) as GhCliIssue[];
      const closedIssues = JSON.parse(closedStdout) as GhCliIssue[];
      const all = [...openIssues, ...closedIssues];

      const newCache = all.map(issue => this.mapGhCliIssue(issue));
      // Preserve local status overrides — but respect remote terminal states (done)
      const oldStatusMap = new Map(this.cache.map(t => [t.id, t.status]));
      for (const t of newCache) {
        if (t.status === 'done') { continue; } // remote terminal state wins
        const oldStatus = oldStatusMap.get(t.id);
        if (oldStatus && oldStatus !== t.status) { t.status = oldStatus; }
      }
      // Keep locally-tracked tasks beyond 'todo' that disappeared from remote
      const newIds = new Set(newCache.map(t => t.id));
      for (const old of this.cache) {
        if (!newIds.has(old.id) && old.status !== 'todo') { newCache.push(old); }
      }
      this.cache = newCache;
      this.cacheTimestamp = Date.now();
      return this.cache;
    } catch {
      // gh failed — clear cache so next call retries
      return this.cache;
    }
  }

  /** Fetch issues via REST API (SSO token). */
  private async fetchTasksViaApi(): Promise<KanbanTask[]> {
    await this.ensureToken();

    if (!this.owner && this.token) {
      await this.fillOwnerFromSso();
    }

    if (!this.token || !this.owner || !this.repo) { return []; }

    const issues: GitHubIssue[] = [];
    let page = 1;
    const maxPages = 5;

    while (page <= maxPages) {
      let url = `https://api.github.com/repos/${this.owner}/${this.repo}/issues?state=all&per_page=${this.perPage}&page=${page}`;
      if (this.onlyAssignedToMe && this.token) {
        // GitHub REST API: filter by current authenticated user's login
        try {
          const userRes = await fetch('https://api.github.com/user', { headers: this.apiHeaders() });
          if (userRes.ok) {
            const user = await userRes.json() as { login: string };
            url += `&assignee=${encodeURIComponent(user.login)}`;
          }
        } catch { /* ignore */ }
      }
      const res = await fetch(url, { headers: this.apiHeaders() });
      if (!res.ok) {
        throw new Error(`GitHub API error: ${res.status} ${res.statusText}`);
      }
      const batch = (await res.json()) as GitHubIssue[];
      issues.push(...batch);
      if (batch.length < this.perPage) { break; }
      page++;
    }

    // Preserve local status overrides — but respect remote terminal states (done)
    const oldStatusMap = new Map(this.cache.map(t => [t.id, t.status]));
    const newCache = issues.map(issue => this.mapIssue(issue));
    for (const t of newCache) {
      if (t.status === 'done') { continue; } // remote terminal state wins
      const oldStatus = oldStatusMap.get(t.id);
      if (oldStatus && oldStatus !== t.status) { t.status = oldStatus; }
    }
    // Keep locally-tracked tasks beyond 'todo' that disappeared from remote
    const newIds2 = new Set(newCache.map(t => t.id));
    for (const old of this.cache) {
      if (!newIds2.has(old.id) && old.status !== 'todo') { newCache.push(old); }
    }
    this.cache = newCache;
    this.cacheTimestamp = Date.now();
    return this.cache;
  }

  // ── private — mapping ───────────────────────────────────────────────

  /** Map a `gh` CLI JSON issue to a `KanbanTask`. */
  private mapGhCliIssue(issue: GhCliIssue): KanbanTask {
    const labels = (issue.labels ?? []).map(l =>
      typeof l === 'string' ? l : l.name,
    );
    const assignee = issue.assignees?.[0]?.login;
    if (assignee && this.issueManager) {
      void this.issueManager.getAvatarUrl(assignee);
    }
    return {
      id: `${this.id}:${issue.number}`,
      title: issue.title,
      body: issue.body ?? '',
      status: this.mapStatus(issue.state, labels.map(l => ({ name: l }))),
      labels,
      assignee,
      url: issue.url,
      providerId: this.id,
      createdAt: issue.createdAt ? new Date(issue.createdAt) : undefined,
      meta: { ...(issue as unknown as Record<string, unknown>), remoteStatus: issue.state === 'OPEN' || issue.state === 'open' ? 'Open' : 'Closed' },
    };
  }

  /** Map a REST API issue to a `KanbanTask`. */
  private mapIssue(issue: GitHubIssue): KanbanTask {
    const assigneeLogin = issue.assignee?.login;
    if (assigneeLogin && this.issueManager) {
      void this.issueManager.getAvatarUrl(assigneeLogin);
    }
    return {
      id: `${this.id}:${issue.number}`,
      title: issue.title,
      body: issue.body ?? '',
      status: this.mapStatus(issue.state, issue.labels),
      labels: issue.labels.map(l => l.name),
      assignee: assigneeLogin,
      url: issue.html_url,
      providerId: this.id,
      createdAt: new Date(issue.created_at),
      meta: {
        ...(issue as unknown as Record<string, unknown>),
        avatarUrl: (issue as unknown as { assignee?: { avatar_url?: string } }).assignee?.avatar_url,
        remoteStatus: issue.state === 'open' ? 'Open' : 'Closed',
      },
    };
  }

  private mapStatus(state: string, labels: Array<{ name: string }>): ColumnId {
    if (state === 'closed' || state === 'CLOSED') {
      return 'done';
    }
    const labelNames = labels.map(l => l.name.toLowerCase());
    if (labelNames.includes('kanban:done'))        { return 'done'; }
    if (labelNames.includes('kanban:review'))      { return 'review'; }
    if (labelNames.includes('kanban:in-progress')) { return 'inprogress'; }
    if (labelNames.includes('kanban:todo'))        { return 'todo'; }
    if (labelNames.includes('in progress') || labelNames.includes('wip')) {
      return 'inprogress';
    }
    if (labelNames.includes('review') || labelNames.includes('needs review')) {
      return 'review';
    }
    return 'todo';
  }

  /** Derive `owner` from the GitHub SSO session account name. */
  private async fillOwnerFromSso(): Promise<void> {
    try {
      const session = await vscode.authentication.getSession('github', ['repo'], { createIfNone: false });
      if (session?.account?.label) {
        this.owner = session.account.label;
      }
    } catch {
      // SSO not available
    }
  }

  private apiHeaders(): Record<string, string> {
    return {
      'Accept': 'application/vnd.github+json',
      'Authorization': `Bearer ${this.token}`,
      'X-GitHub-Api-Version': '2022-11-28',
    };
  }
}

// ── gh CLI JSON shape ─────────────────────────────────────────────────────

interface GhCliIssue {
  number: number;
  title: string;
  body: string | null;
  state: string; // "OPEN" | "CLOSED"
  labels: Array<string | { name: string }>;
  assignees?: Array<{ login: string }>;
  url: string;
  createdAt?: string;
}

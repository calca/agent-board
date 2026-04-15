import * as vscode from 'vscode';
import { ProjectConfig } from '../config/ProjectConfig';
import { ColumnId } from '../types/ColumnId';
import { KanbanTask } from '../types/KanbanTask';
import { Logger } from '../utils/logger';
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

// ── Kanban column → GitHub label mapping ──────────────────────────────────────

const KANBAN_LABELS: Record<string, string> = {
  todo:       'kanban:todo',
  inprogress: 'kanban:in-progress',
  review:     'kanban:review',
  done:       'kanban:done',
};

const ALL_KANBAN_LABELS = Object.values(KANBAN_LABELS);

/**
 * Task provider backed by GitHub Issues.
 *
 * Requires the **`gh` CLI** (https://cli.github.com).
 *
 * Repository coordinates (`owner`/`repo`) are resolved in order:
 *   1. `.agent-board/config.json`
 *   2. VS Code settings (`agentBoard.github.owner` / `.repo`)
 *   3. `gh repo view --json owner,name` (auto-detect from working directory)
 */
export class GitHubProvider implements ITaskProvider {
  readonly id = 'github';
  readonly displayName = 'GitHub Issues';
  readonly icon = 'github';

  private readonly _onDidChangeTasks = new vscode.EventEmitter<KanbanTask[]>();
  readonly onDidChangeTasks = this._onDidChangeTasks.event;

  /** Fires when remote changes are detected during polling. */
  private readonly _onDidDetectRemoteChange = new vscode.EventEmitter<void>();
  readonly onDidDetectRemoteChange: vscode.Event<void> = this._onDidDetectRemoteChange.event;

  private cache: KanbanTask[] = [];
  private cacheTimestamp = 0;

  private owner = '';
  private repo = '';
  private cacheTtlMs = 60_000;
  private onlyAssignedToMe = false;
  /** `true` after we confirmed `gh` is available. */
  private ghCliAvailable: boolean | undefined;
  private pollTimer: ReturnType<typeof setInterval> | undefined;
  private lastEtag: string | undefined;
  private readonly avatarCache = new Map<string, string>();

  constructor(
    private readonly context: vscode.ExtensionContext,
  ) {
    this.readConfig();
  }

  async getTasks(): Promise<KanbanTask[]> {
    if (!this.isEnabled()) { return []; }
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
    const issueNumber = parseInt(task.nativeId, 10);
    const state = task.status === 'done' ? 'closed' : 'open';

    const syncRemote = async () => {
      const repoSlug = `${this.owner}/${this.repo}`;
      if (state === 'closed') {
        await this.execGh(['issue', 'close', task.nativeId, '--repo', repoSlug]);
      } else {
        await this.execGh(['issue', 'reopen', task.nativeId, '--repo', repoSlug]);
      }

      // Sync kanban column label
      if (!isNaN(issueNumber)) {
        await this.syncIssueColumn(issueNumber, task.status);
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
    if (!this.isEnabled()) {
      this.cache = [];
      this.cacheTimestamp = 0;
      this._onDidChangeTasks.fire(this.cache);
      return;
    }
    Logger.getInstance().debug('GitHubProvider: refreshing %s/%s', this.owner, this.repo);
    this.cacheTimestamp = 0;
    const tasks = await this.fetchTasks();
    Logger.getInstance().info('GitHubProvider: fetched %d issue(s)', tasks.length);
    this._onDidChangeTasks.fire(tasks);
  }


  dispose(): void {
    this.stopPolling();
    this._onDidChangeTasks.dispose();
    this._onDidDetectRemoteChange.dispose();
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
    const ghOk = await this.hasGhCli();
    if (!ghOk) {
      return { severity: 'error', message: 'GitHub CLI (gh) not found. Install: brew install gh — https://cli.github.com' };
    }

    const authOk = await execShellOk('gh', ['auth', 'status'], { timeout: 5_000 });
    if (!authOk) {
      return { severity: 'error', message: 'gh CLI found but not authenticated. Run: gh auth login' };
    }

    if (!this.owner || !this.repo) {
      const detected = await this.detectRepoFromGh();
      if (!detected) {
        return { severity: 'warning', message: 'gh CLI authenticated, but owner/repo not configured and not inside a GitHub repo.' };
      }
    }

    return { severity: 'ok', message: `gh CLI → ${this.owner}/${this.repo}` };
  }

  isEnabled(): boolean {
    const cfg = ProjectConfig.getProjectConfig();
    return cfg?.github?.enabled === true;
  }

  getIssueRetrievalPrompt(task: KanbanTask): string | undefined {
    const issueNumber = task.nativeId;
    if (!this.owner || !this.repo || !issueNumber) { return undefined; }
    return (
      'Before starting, run the following command to retrieve the full issue details ' +
      '(including all comments, labels, and metadata). ' +
      'Execute this command first and use the output as the complete specification for your work.\n\n' +
      '```\n' +
      `gh issue view ${issueNumber} --repo ${this.owner}/${this.repo} --comments\n` +
      '```'
    );
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
    const log = Logger.getInstance();
    log.debug('GitHubProvider: exec → gh %s', args.join(' '));
    const { stdout } = await execShell('gh', args, { timeout: 30_000, cwd });
    log.debug('GitHubProvider: stdout (%d chars) → %s', stdout.length, stdout.slice(0, 2000));
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

  // ── private — config ─────────────────────────────────────────────

  private readConfig(): void {
    const ghCfg = ProjectConfig.getGitHubConfig();
    this.owner = ghCfg.owner;
    this.repo = ghCfg.repo;
    this.cacheTtlMs = 60_000;
    this.onlyAssignedToMe = ProjectConfig.getProjectConfig()?.github?.onlyAssignedToMe === true;
  }

  private isCacheValid(): boolean {
    return this.cache.length > 0 && Date.now() - this.cacheTimestamp < this.cacheTtlMs;
  }

  // ── private — fetching ──────────────────────────────────────────────

  private async fetchTasks(): Promise<KanbanTask[]> {
    return this.fetchTasksViaGh();
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

  // ── private — mapping ───────────────────────────────────────────────

  /** Map a `gh` CLI JSON issue to a `KanbanTask`. */
  private mapGhCliIssue(issue: GhCliIssue): KanbanTask {
    const labels = (issue.labels ?? []).map(l =>
      typeof l === 'string' ? l : l.name,
    );
    const assignee = issue.assignees?.[0]?.login;
    if (assignee) {
      void this.fetchAvatarUrl(assignee);
    }
    return {
      id: `${this.id}:${issue.number}`,
      nativeId: String(issue.number),
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

  // ── Kanban label management ─────────────────────────────────────────

  /**
   * Ensure the required kanban labels exist on the repo (idempotent).
   * Call once during extension activation when GitHub provider is active.
   */
  async ensureKanbanLabels(): Promise<void> {
    if (!this.owner || !this.repo) { return; }
    const repoSlug = `${this.owner}/${this.repo}`;
    const colors: Record<string, string> = {
      'kanban:todo':        'bfd4f2',
      'kanban:in-progress': 'f9d0c4',
      'kanban:review':      'e4e669',
      'kanban:done':        'c2e0c6',
    };
    await Promise.all(
      Object.entries(colors).map(async ([name, color]) => {
        try {
          await this.execGh([
            'label', 'create', name,
            '--color', color,
            '--repo', repoSlug,
            '--force',
          ]);
        } catch {
          // label may already exist — non-fatal
        }
      }),
    );
  }

  /**
   * Sync the kanban label on an issue when a card is moved.
   * Removes all existing `kanban:*` labels and adds the one for `columnId`.
   */
  private async syncIssueColumn(issueNumber: number, columnId: ColumnId): Promise<void> {
    if (!this.owner || !this.repo) { return; }
    const repoSlug = `${this.owner}/${this.repo}`;
    const issueStr = String(issueNumber);

    // Remove old kanban labels
    await Promise.all(
      ALL_KANBAN_LABELS.map(label =>
        this.execGh(['issue', 'edit', issueStr, '--repo', repoSlug, '--remove-label', label])
          .catch(() => { /* ignore if label not present */ }),
      ),
    );

    const newLabel = KANBAN_LABELS[columnId];
    if (!newLabel) { return; }

    await this.execGh(['issue', 'edit', issueStr, '--repo', repoSlug, '--add-label', newLabel])
      .catch(() => { /* non-fatal */ });
  }

  // ── Polling ─────────────────────────────────────────────────────────

  /**
   * Start polling for remote issue changes every `intervalMs` milliseconds.
   * Fires `onDidDetectRemoteChange` when changes are detected.
   */
  startPolling(intervalMs = 30_000): void {
    this.stopPolling();
    this.pollTimer = setInterval(() => void this.poll(), intervalMs);
    void this.poll();
  }

  stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = undefined;
    }
  }

  private async poll(): Promise<void> {
    if (!this.owner || !this.repo) { return; }
    try {
      const stdout = await this.execGh([
        'api', `repos/${this.owner}/${this.repo}/issues`,
        '-X', 'GET',
        '-f', 'per_page=1',
        '-f', 'state=all',
        '--include',
      ]);
      // Extract ETag from response headers (first lines before JSON body)
      const etagMatch = stdout.match(/etag:\s*"?([^"\r\n]+)"?/i);
      const etag = etagMatch?.[1];
      if (etag && etag !== this.lastEtag) {
        if (this.lastEtag !== undefined) {
          // Only fire after the first poll (skip initial)
          this._onDidDetectRemoteChange.fire();
        }
        this.lastEtag = etag;
      }
    } catch {
      // poll error — non-fatal
    }
  }

  // ── Avatar ──────────────────────────────────────────────────────────

  private async fetchAvatarUrl(login: string): Promise<void> {
    if (this.avatarCache.has(login)) { return; }
    try {
      const stdout = await this.execGh(['api', `users/${login}`, '-q', '.avatar_url']);
      const url = stdout.trim();
      if (url) { this.avatarCache.set(login, url); }
    } catch {
      // non-fatal
    }
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

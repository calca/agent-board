import * as vscode from 'vscode';
import { ProjectConfig } from '../config/ProjectConfig';
import { ColumnId } from '../types/ColumnId';
import { Logger } from '../utils/logger';

// ── Kanban column → GitHub label mapping ──────────────────────────────────────
/**
 * Labels added/removed on the issue when a card moves to a column.
 * Labels are managed as a set: any other kanban: label is removed.
 */
export const KANBAN_LABELS: Record<string, string> = {
  todo:       'kanban:todo',
  inprogress: 'kanban:in-progress',
  review:     'kanban:review',
  done:       'kanban:done',
};

/** All kanban label values (for "remove all then add current" logic). */
export const ALL_KANBAN_LABELS = Object.values(KANBAN_LABELS);

export interface GitHubIssueLabel {
  name: string;
  color: string;
}

export interface AssigneeAvatar {
  login: string;
  avatarUrl: string;
}

/**
 * Thin wrapper around GitHub Issues REST API for label management,
 * polling-based sync, and comment posting.
 *
 * All API calls use the VS Code built-in GitHub SSO token.
 */
export class GitHubIssueManager implements vscode.Disposable {
  private readonly logger = Logger.getInstance();
  private token = '';
  private owner = '';
  private repo = '';

  /** Fires when remote changes are detected during polling. */
  private readonly _onDidDetectRemoteChange = new vscode.EventEmitter<void>();
  readonly onDidDetectRemoteChange: vscode.Event<void> = this._onDidDetectRemoteChange.event;

  private pollTimer: ReturnType<typeof setInterval> | undefined;
  /** ETag from last poll — used for conditional GET to avoid rate-limit. */
  private lastEtag: string | undefined;
  /** Cache of avatar URLs keyed by login. */
  private readonly avatarCache = new Map<string, string>();

  constructor() {
    this.readConfig();
  }

  // ── Label sync ────────────────────────────────────────────────────────────

  /**
   * Ensure the required kanban labels exist on the repo (idempotent).
   * Call once during extension activation when GitHub provider is active.
   */
  async ensureKanbanLabels(): Promise<void> {
    await this.ensureToken();
    if (!this.token || !this.owner || !this.repo) { return; }

    const colors: Record<string, string> = {
      'kanban:todo':        'bfd4f2',
      'kanban:in-progress': 'f9d0c4',
      'kanban:review':      'e4e669',
      'kanban:done':        'c2e0c6',
    };

    await Promise.all(
      Object.entries(colors).map(async ([name, color]) => {
        // Try create; if 422 "already exists" that's fine
        const res = await fetch(
          `https://api.github.com/repos/${this.owner}/${this.repo}/labels`,
          {
            method: 'POST',
            headers: this.headers(),
            body: JSON.stringify({ name, color }),
          },
        );
        if (!res.ok && res.status !== 422) {
          this.logger.warn('GitHubIssueManager: could not create label "%s": %d', name, res.status);
        }
      }),
    );
  }

  /**
   * Update the kanban label on an issue when a card is moved.
   *
   * Removes all existing `kanban:*` labels and adds the one corresponding
   * to `columnId`.  Mutates the issue in-place (PATCH labels endpoint).
   */
  async syncIssueColumn(issueNumber: number, columnId: ColumnId): Promise<void> {
    await this.ensureToken();
    if (!this.token || !this.owner || !this.repo) { return; }

    // Remove old kanban labels
    await Promise.all(
      ALL_KANBAN_LABELS.map(label =>
        fetch(
          `https://api.github.com/repos/${this.owner}/${this.repo}/issues/${issueNumber}/labels/${encodeURIComponent(label)}`,
          { method: 'DELETE', headers: this.headers() },
        ).catch(() => { /* ignore 404 */ }),
      ),
    );

    const newLabel = KANBAN_LABELS[columnId];
    if (!newLabel) { return; }

    await fetch(
      `https://api.github.com/repos/${this.owner}/${this.repo}/issues/${issueNumber}/labels`,
      {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({ labels: [newLabel] }),
      },
    );
  }

  // ── Column detection from labels ──────────────────────────────────────────

  /**
   * Derive the kanban column from the issue's current labels.
   * Returns undefined if no kanban label is present.
   */
  columnFromLabels(labels: string[]): ColumnId | undefined {
    for (const [col, label] of Object.entries(KANBAN_LABELS)) {
      if (labels.includes(label)) { return col; }
    }
    return undefined;
  }

  // ── Remote polling ────────────────────────────────────────────────────────

  /**
   * Start polling the `/repos/{owner}/{repo}/issues` endpoint every
   * `intervalMs` milliseconds (default 30 000).
   *
   * Fires `onDidDetectRemoteChange` when the ETag changes.
   */
  startPolling(intervalMs = 30_000): void {
    this.stopPolling();
    this.pollTimer = setInterval(() => void this.poll(), intervalMs);
    // Immediate first check
    void this.poll();
  }

  stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = undefined;
    }
  }

  // ── Avatar ────────────────────────────────────────────────────────────────

  /**
   * Return the avatar URL for a GitHub user, cached after first fetch.
   */
  async getAvatarUrl(login: string): Promise<string | undefined> {
    if (this.avatarCache.has(login)) {
      return this.avatarCache.get(login);
    }
    await this.ensureToken();
    if (!this.token) { return undefined; }

    const res = await fetch(`https://api.github.com/users/${encodeURIComponent(login)}`, {
      headers: this.headers(),
    });
    if (!res.ok) { return undefined; }

    const data = (await res.json()) as { avatar_url: string };
    const url = data.avatar_url;
    this.avatarCache.set(login, url);
    return url;
  }

  // ── Comment posting ───────────────────────────────────────────────────────

  /**
   * Post a markdown summary comment on a GitHub issue after agent completion.
   *
   * @param issueNumber  Native GitHub issue number (no provider prefix).
   * @param summary      Markdown body.
   */
  async postAgentSummaryComment(issueNumber: number, summary: string): Promise<void> {
    await this.ensureToken();
    if (!this.token || !this.owner || !this.repo) { return; }

    const res = await fetch(
      `https://api.github.com/repos/${this.owner}/${this.repo}/issues/${issueNumber}/comments`,
      {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({ body: summary }),
      },
    );
    if (!res.ok) {
      this.logger.error(
        'GitHubIssueManager: failed to post comment on #%d: %d %s',
        issueNumber,
        res.status,
        res.statusText,
      );
    }
  }

  /**
   * Build the markdown summary comment body from session artifacts.
   */
  buildAgentSummaryMarkdown(params: {
    agentName: string;
    issueTitle: string;
    changedFiles: Array<{ path: string; status: 'added' | 'modified' | 'deleted' }>;
    prUrl?: string;
    streamSummary?: string;
  }): string {
    const fileLines = params.changedFiles.map(f => {
      const icon = f.status === 'added' ? '➕' : f.status === 'deleted' ? '❌' : '✏️';
      return `- ${icon} \`${f.path}\``;
    });

    const filesSection = fileLines.length > 0
      ? `\n\n### Modifiche effettuate\n\n${fileLines.join('\n')}`
      : '';

    const prSection = params.prUrl
      ? `\n\n### Pull Request\n\n[Apri PR](${params.prUrl})`
      : '';

    const summarySection = params.streamSummary
      ? `\n\n### Output agente\n\n<details><summary>Mostra output</summary>\n\n\`\`\`\n${params.streamSummary}\n\`\`\`\n\n</details>`
      : '';

    return (
      `## 🤖 Agent Board — sessione completata\n\n` +
      `**Issue:** ${params.issueTitle}\n` +
      `**Agente:** ${params.agentName}` +
      filesSection +
      prSection +
      summarySection
    );
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  dispose(): void {
    this.stopPolling();
    this._onDidDetectRemoteChange.dispose();
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private readConfig(): void {
    const ghCfg = ProjectConfig.getGitHubConfig();
    this.owner = ghCfg.owner;
    this.repo = ghCfg.repo;
  }

  private async ensureToken(): Promise<void> {
    if (this.token) { return; }
    this.readConfig();
    try {
      const session = await vscode.authentication.getSession('github', ['repo'], {
        createIfNone: false,
      });
      if (session) { this.token = session.accessToken; }
    } catch { /* SSO not available */ }
  }

  private async poll(): Promise<void> {
    await this.ensureToken();
    if (!this.token || !this.owner || !this.repo) { return; }

    // Conditional GET using ETag to avoid counting against rate-limit
    const reqHeaders: Record<string, string> = { ...this.headers() };
    if (this.lastEtag) { reqHeaders['If-None-Match'] = this.lastEtag; }

    try {
      const res = await fetch(
        `https://api.github.com/repos/${this.owner}/${this.repo}/issues?per_page=1&state=all`,
        { headers: reqHeaders },
      );

      if (res.status === 304) {
        // No change
        return;
      }

      const etag = res.headers.get('etag') ?? undefined;
      if (etag && etag !== this.lastEtag) {
        this.lastEtag = etag;
        this._onDidDetectRemoteChange.fire();
      }
    } catch (e) {
      this.logger.warn('GitHubIssueManager: poll error', e);
    }
  }

  private headers(): Record<string, string> {
    return {
      'Accept':               'application/vnd.github+json',
      'Authorization':        `Bearer ${this.token}`,
      'X-GitHub-Api-Version': '2022-11-28',
    };
  }
}

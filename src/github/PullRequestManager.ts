import * as vscode from 'vscode';
import { ProjectConfig } from '../config/ProjectConfig';
import { Logger } from '../utils/logger';

export interface PullRequestResult {
  number: number;
  url: string;
  state: 'open' | 'closed' | 'merged';
}

/**
 * Manages GitHub Pull Requests via the REST API.
 *
 * - `createPR()` — creates a PR from a worktree branch, shows a
 *   confirmation dialog before submission.
 * - Tracks PR state so the Kanban card can display status.
 * - Supports post-creation cleanup of the worktree (fire-and-forget).
 */
export class PullRequestManager {
  private readonly logger = Logger.getInstance();
  private token = '';
  private owner = '';
  private repo = '';

  constructor() {
    this.readConfig();
  }

  /** Create a PR from `headBranch` into `baseBranch` (default: main). */
  async createPR(params: {
    title: string;
    body: string;
    headBranch: string;
    baseBranch?: string;
  }): Promise<PullRequestResult | undefined> {
    await this.ensureToken();
    this.readConfig();

    if (!this.token || !this.owner || !this.repo) {
      vscode.window.showErrorMessage(
        'GitHub auth or repo config missing. Please sign in and configure owner/repo.',
      );
      return undefined;
    }

    // Confirmation dialog
    const confirm = await vscode.window.showInformationMessage(
      `Create PR "${params.title}" (${params.headBranch} → ${params.baseBranch ?? 'main'})?`,
      { modal: true },
      'Create',
    );
    if (confirm !== 'Create') {
      return undefined;
    }

    const base = params.baseBranch ?? 'main';

    const res = await fetch(
      `https://api.github.com/repos/${this.owner}/${this.repo}/pulls`,
      {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({
          title: params.title,
          body: params.body,
          head: params.headBranch,
          base,
        }),
      },
    );

    if (!res.ok) {
      const errBody = await res.text();
      this.logger.error('PullRequestManager: create failed', res.status, errBody);
      vscode.window.showErrorMessage(`Failed to create PR: ${res.status} ${res.statusText}`);
      return undefined;
    }

    const data = (await res.json()) as { number: number; html_url: string; state: string };
    this.logger.info('PullRequestManager: PR #%d created — %s', data.number, data.html_url);

    return {
      number: data.number,
      url: data.html_url,
      state: data.state as PullRequestResult['state'],
    };
  }

  /** Get the current state of an existing PR by number. */
  async getPRState(prNumber: number): Promise<PullRequestResult['state'] | undefined> {
    await this.ensureToken();
    this.readConfig();

    if (!this.token || !this.owner || !this.repo) {
      return undefined;
    }

    const res = await fetch(
      `https://api.github.com/repos/${this.owner}/${this.repo}/pulls/${prNumber}`,
      { headers: this.headers() },
    );

    if (!res.ok) {
      return undefined;
    }

    const data = (await res.json()) as { state: string; merged: boolean };
    if (data.merged) { return 'merged'; }
    return data.state as PullRequestResult['state'];
  }

  // ── private ──────────────────────────────────────────────────────

  private readConfig(): void {
    const ghCfg = ProjectConfig.getGitHubConfig();
    this.owner = ghCfg.owner;
    this.repo = ghCfg.repo;
  }

  private async ensureToken(): Promise<void> {
    if (this.token) { return; }
    try {
      const session = await vscode.authentication.getSession('github', ['repo'], {
        createIfNone: false,
      });
      if (session) {
        this.token = session.accessToken;
      }
    } catch {
      // SSO not available
    }
  }

  private headers(): Record<string, string> {
    return {
      'Accept': 'application/vnd.github+json',
      'Authorization': `Bearer ${this.token}`,
      'X-GitHub-Api-Version': '2022-11-28',
    };
  }
}

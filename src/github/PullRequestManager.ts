import * as vscode from 'vscode';
import { ProjectConfig } from '../config/ProjectConfig';
import { execShell } from '../providers/execShell';
import { formatError } from '../utils/errorUtils';
import { Logger } from '../utils/logger';

export interface PullRequestResult {
  number: number;
  url: string;
  state: 'open' | 'closed' | 'merged';
}

/**
 * Manages Pull Requests via CLI tools.
 *
 * - GitHub: `gh pr create` / `gh pr view`
 * - Azure DevOps: `az repos pr create` / `az repos pr show`
 */
export class PullRequestManager {
  private readonly logger = Logger.getInstance();

  /** Create a PR from `headBranch` into `baseBranch` (default: main). */
  async createPR(params: {
    title: string;
    body: string;
    headBranch: string;
    baseBranch?: string;
    isAzureDevOps?: boolean;
  }): Promise<PullRequestResult | undefined> {
    if (params.isAzureDevOps) {
      return this.createAzureDevOpsPR(params);
    }
    return this.createGitHubPR(params);
  }

  /** Get the current state of an existing PR by number. */
  async getPRState(prNumber: number, isAzureDevOps?: boolean): Promise<PullRequestResult['state'] | undefined> {
    if (isAzureDevOps) {
      return this.getAzureDevOpsPRState(prNumber);
    }
    return this.getGitHubPRState(prNumber);
  }

  // ── GitHub (gh CLI) ─────────────────────────────────────────────

  private async createGitHubPR(params: {
    title: string;
    body: string;
    headBranch: string;
    baseBranch?: string;
  }): Promise<PullRequestResult | undefined> {
    const confirm = await vscode.window.showInformationMessage(
      `Create PR "${params.title}" (${params.headBranch} → ${params.baseBranch ?? 'main'})?`,
      { modal: true },
      'Create',
    );
    if (confirm !== 'Create') { return undefined; }

    const base = params.baseBranch ?? 'main';
    const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!cwd) { vscode.window.showErrorMessage('No workspace folder open.'); return undefined; }

    try {
      const { stdout } = await execShell('gh', [
        'pr', 'create',
        '--title', params.title,
        '--body', params.body,
        '--head', params.headBranch,
        '--base', base,
        '--json', 'number,url,state',
      ], { cwd });

      const data = JSON.parse(stdout) as { number: number; url: string; state: string };
      this.logger.info('PullRequestManager: GitHub PR #%d created — %s', data.number, data.url);
      return { number: data.number, url: data.url, state: data.state as PullRequestResult['state'] };
    } catch (err) {
      this.logger.error('PullRequestManager: GitHub create failed —', formatError(err));
      vscode.window.showErrorMessage(`Failed to create PR: ${formatError(err)}`);
      return undefined;
    }
  }

  private async getGitHubPRState(prNumber: number): Promise<PullRequestResult['state'] | undefined> {
    const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!cwd) { return undefined; }
    try {
      const { stdout } = await execShell('gh', [
        'pr', 'view', String(prNumber), '--json', 'state',
      ], { cwd });
      const data = JSON.parse(stdout) as { state: string };
      const state = data.state.toUpperCase();
      if (state === 'MERGED') { return 'merged'; }
      if (state === 'CLOSED') { return 'closed'; }
      return 'open';
    } catch { return undefined; }
  }

  // ── Azure DevOps (az repos pr) ──────────────────────────────────

  private async createAzureDevOpsPR(params: {
    title: string;
    body: string;
    headBranch: string;
    baseBranch?: string;
  }): Promise<PullRequestResult | undefined> {
    const confirm = await vscode.window.showInformationMessage(
      `Create PR "${params.title}" (${params.headBranch} → ${params.baseBranch ?? 'main'})?`,
      { modal: true },
      'Create',
    );
    if (confirm !== 'Create') { return undefined; }

    const base = params.baseBranch ?? 'main';
    const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!cwd) { vscode.window.showErrorMessage('No workspace folder open.'); return undefined; }

    const azCfg = ProjectConfig.getProjectConfig()?.azureDevOps;
    const org = azCfg?.organization ?? '';
    const project = azCfg?.project ?? '';

    const args = [
      'repos', 'pr', 'create',
      '--title', params.title,
      '--description', params.body,
      '--source-branch', params.headBranch,
      '--target-branch', base,
      '--output', 'json',
    ];
    if (org) { args.push('--org', org); }
    if (project) { args.push('--project', project); }

    try {
      const { stdout } = await execShell('az', args, { cwd });
      const data = JSON.parse(stdout) as { pullRequestId: number; url: string; status: string };
      this.logger.info('PullRequestManager: Azure DevOps PR #%d created — %s', data.pullRequestId, data.url);
      return {
        number: data.pullRequestId,
        url: data.url,
        state: this.mapAzureState(data.status),
      };
    } catch (err) {
      this.logger.error('PullRequestManager: Azure DevOps create failed —', formatError(err));
      vscode.window.showErrorMessage(`Failed to create PR: ${formatError(err)}`);
      return undefined;
    }
  }

  private async getAzureDevOpsPRState(prNumber: number): Promise<PullRequestResult['state'] | undefined> {
    const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!cwd) { return undefined; }

    const azCfg = ProjectConfig.getProjectConfig()?.azureDevOps;
    const org = azCfg?.organization ?? '';

    const args = ['repos', 'pr', 'show', '--id', String(prNumber), '--output', 'json'];
    if (org) { args.push('--org', org); }

    try {
      const { stdout } = await execShell('az', args, { cwd });
      const data = JSON.parse(stdout) as { status: string };
      return this.mapAzureState(data.status);
    } catch { return undefined; }
  }

  private mapAzureState(status: string): PullRequestResult['state'] {
    switch (status.toLowerCase()) {
      case 'completed': return 'merged';
      case 'abandoned': return 'closed';
      default: return 'open'; // active
    }
  }
}

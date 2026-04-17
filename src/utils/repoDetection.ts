import { exec } from 'child_process';
import * as os from 'os';
import * as vscode from 'vscode';

// ── Git / GitHub / Azure detection helpers ──────────────────────────────────

/** Cache for workspace git/github detection (computed once per session). */
let _isGitRepo: boolean | undefined;
let _isGitHubRepo: boolean | undefined;
let _isAzureDevOpsRepo: boolean | undefined;

function shellCheck(cmd: string, cwd: string): Promise<boolean> {
  return new Promise(resolve => {
    exec(cmd, { cwd, timeout: 5_000 }, (err, stdout) => {
      if (err) { resolve(false); return; }
      resolve(stdout.trim().length > 0);
    });
  });
}

export async function isGitRepository(): Promise<boolean> {
  if (_isGitRepo !== undefined) { return _isGitRepo; }
  const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!root) { _isGitRepo = false; return false; }
  _isGitRepo = await shellCheck('git rev-parse --is-inside-work-tree', root);
  return _isGitRepo;
}

export async function isGitHubRepository(): Promise<boolean> {
  if (_isGitHubRepo !== undefined) { return _isGitHubRepo; }
  const isGit = await isGitRepository();
  if (!isGit) { _isGitHubRepo = false; return false; }
  const root = vscode.workspace.workspaceFolders![0].uri.fsPath;
  _isGitHubRepo = await shellCheck('git remote -v | grep -i github.com', root);
  return _isGitHubRepo;
}

export async function isAzureDevOpsRepository(): Promise<boolean> {
  if (_isAzureDevOpsRepo !== undefined) { return _isAzureDevOpsRepo; }
  const isGit = await isGitRepository();
  if (!isGit) { _isAzureDevOpsRepo = false; return false; }
  const root = vscode.workspace.workspaceFolders![0].uri.fsPath;
  _isAzureDevOpsRepo = await shellCheck('git remote -v | grep -iE "dev\\.azure\\.com|visualstudio\\.com"', root);
  return _isAzureDevOpsRepo;
}

/**
 * List local git branches for the workspace, returning branch names
 * and the current branch. Returns empty arrays when not a git repo.
 */
export async function listGitBranches(): Promise<{ branches: string[]; current: string }> {
  const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!root || !(await isGitRepository())) { return { branches: [], current: '' }; }
  try {
    const raw = await execPromise('git branch --format="%(refname:short)"', { cwd: root });
    const current = (await execPromise('git rev-parse --abbrev-ref HEAD', { cwd: root })).trim();

    // Exclude worktree branches (prefixed "agent-board/")
    const branches = raw.split('\n').map(b => b.trim()).filter(b => b && !b.startsWith('agent-board/'));
    return { branches, current };
  } catch {
    return { branches: [], current: '' };
  }
}

/** Send available branches to the panel. */
export async function sendBranchesToPanel(panel: import('../kanban/KanbanPanel').KanbanPanel): Promise<void> {
  const { branches, current } = await listGitBranches();
  if (branches.length > 0) {
    panel.postMessage({ type: 'branchesAvailable', branches, current });
  }
}

/** Get the first non-internal IPv4 address. */
export function getLocalIPv4(): string | undefined {
  const interfaces = os.networkInterfaces();
  for (const values of Object.values(interfaces)) {
    for (const entry of values ?? []) {
      if (entry.family === 'IPv4' && !entry.internal) {
        return entry.address;
      }
    }
  }
  return undefined;
}

/** Promisified `exec` helper for git commands. */
export function execPromise(command: string, options: { cwd: string }): Promise<string> {
  return new Promise((resolve, reject) => {
    exec(command, { cwd: options.cwd, timeout: 30_000 }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(stderr?.trim() || err.message));
      } else {
        resolve(stdout.trim());
      }
    });
  });
}

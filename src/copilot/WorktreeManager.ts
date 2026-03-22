import { execFile } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

/**
 * Result of creating a git worktree for a task.
 */
export interface WorktreeInfo {
  /** Absolute path to the worktree directory. */
  readonly path: string;
  /** Branch name created for this worktree. */
  readonly branch: string;
}

/**
 * Sanitise a task identifier so it can be used as a git branch name
 * and directory segment.
 *
 * Rules applied (mirrors `git check-ref-format`):
 * - Replace characters that are invalid in branch names with `-`
 * - Collapse consecutive dashes
 * - Strip leading / trailing dashes
 * - Truncate to 60 characters for readability
 */
export function sanitiseBranchName(taskId: string): string {
  return taskId
    .replace(/[^a-zA-Z0-9/_.-]/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

/**
 * Build the worktree directory path for a given task.
 *
 * The worktree is placed inside `<repoRoot>/.agent-board/worktrees/<sanitised>`.
 */
export function worktreePath(repoRoot: string, taskId: string): string {
  return path.join(repoRoot, '.agent-board', 'worktrees', sanitiseBranchName(taskId));
}

/**
 * Build the branch name for a given task.
 */
export function worktreeBranch(taskId: string): string {
  return `agent-board/${sanitiseBranchName(taskId)}`;
}

/** Helper: promisified `execFile`. */
function exec(cmd: string, args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { cwd, timeout: 30_000 }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(`${cmd} ${args.join(' ')} failed: ${stderr || err.message}`));
      } else {
        resolve(stdout.trim());
      }
    });
  });
}

/**
 * Check whether a directory is inside a git repository.
 */
export async function isGitRepo(dir: string): Promise<boolean> {
  try {
    await exec('git', ['rev-parse', '--is-inside-work-tree'], dir);
    return true;
  } catch {
    return false;
  }
}

/**
 * Create a git worktree for the given task.
 *
 * - Creates a new branch `agent-board/<sanitised-taskId>` based on HEAD.
 * - The worktree is placed under `.agent-board/worktrees/<sanitised-taskId>`.
 * - If the worktree already exists it is **reused** (no error).
 *
 * @returns information about the created worktree, or `undefined` when
 *          the workspace root is not a git repository.
 */
export async function createWorktree(
  repoRoot: string,
  taskId: string,
): Promise<WorktreeInfo | undefined> {
  if (!(await isGitRepo(repoRoot))) {
    return undefined;
  }

  const wtPath = worktreePath(repoRoot, taskId);
  const branch = worktreeBranch(taskId);

  // Already exists — reuse
  if (fs.existsSync(wtPath)) {
    return { path: wtPath, branch };
  }

  // Ensure parent directory exists
  const parentDir = path.dirname(wtPath);
  if (!fs.existsSync(parentDir)) {
    fs.mkdirSync(parentDir, { recursive: true });
  }

  await exec('git', ['worktree', 'add', '-b', branch, wtPath], repoRoot);

  return { path: wtPath, branch };
}

/**
 * Remove a previously created worktree.
 *
 * Silently succeeds when the worktree does not exist.
 */
export async function removeWorktree(
  repoRoot: string,
  taskId: string,
): Promise<void> {
  const wtPath = worktreePath(repoRoot, taskId);
  if (!fs.existsSync(wtPath)) {
    return;
  }
  await exec('git', ['worktree', 'remove', '--force', wtPath], repoRoot);
}

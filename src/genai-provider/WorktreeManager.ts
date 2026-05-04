import { execFile } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

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
 * The worktree is placed **outside** the repository to avoid interfering with
 * VS Code file watchers, search indexing and `.gitignore` requirements.
 *
 * Layout: `<parent>/<repoName>.worktrees/<sanitised-taskId>`
 */
export function worktreePath(repoRoot: string, taskId: string): string {
  const parent = path.dirname(repoRoot);
  const repoName = path.basename(repoRoot);
  return path.join(parent, `${repoName}.worktrees`, sanitiseBranchName(taskId));
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
    execFile(cmd, args, { cwd, timeout: 60_000 }, (err, stdout, stderr) => {
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
 * - Creates a new branch `agent-board/<sanitised-taskId>` based on the given
 *   `baseBranch` (defaults to `HEAD` when omitted).
 * - The worktree is placed under `.agent-board/worktrees/<sanitised-taskId>`.
 * - If the worktree already exists it is **reused** (no error).
 *
 * @returns information about the created worktree, or `undefined` when
 *          the workspace root is not a git repository.
 */
export async function createWorktree(
  repoRoot: string,
  taskId: string,
  baseBranch?: string,
): Promise<WorktreeInfo | undefined> {
  if (!(await isGitRepo(repoRoot))) {
    return undefined;
  }

  const wtPath = worktreePath(repoRoot, taskId);
  const branch = worktreeBranch(taskId);

  // Already exists — reuse
  if (fs.existsSync(wtPath)) {
    syncUntrackedPaths(repoRoot, wtPath);
    return { path: wtPath, branch };
  }

  // Ensure parent directory exists
  const parentDir = path.dirname(wtPath);
  if (!fs.existsSync(parentDir)) {
    fs.mkdirSync(parentDir, { recursive: true });
  }

  const args = ['worktree', 'add', '-b', branch, wtPath];
  if (baseBranch) { args.push(baseBranch); }
  await exec('git', args, repoRoot);

  // Sync untracked config files (agents, skills, etc.) into the new worktree.
  syncUntrackedPaths(repoRoot, wtPath);

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

// ── Untracked paths sync ──────────────────────────────────────────────────

/**
 * Paths (relative to the workspace root) that may contain untracked
 * configuration files needed at runtime inside a worktree.
 *
 * Each entry specifies:
 * - `dir`    – relative directory to sync (e.g. `.github/agents`)
 * - `glob`   – filename glob filter (only `*.ext` patterns)
 *
 * Extend this array when new convention directories appear.
 */
export const WORKTREE_SYNC_PATHS: ReadonlyArray<{ dir: string; glob: string }> = [
  { dir: '.github/agents',  glob: '*.md' },
  { dir: '.github/skills',  glob: '*.md' },
  { dir: '.agents',         glob: '*.md' },
  { dir: '.agents/skills',  glob: '*.md' },
];

/**
 * Copy untracked configuration files from the workspace root into a
 * worktree so that tools running inside the worktree (e.g. `copilot
 * --agent <slug>`) can discover them.
 *
 * Only files that don't already exist in the worktree are copied;
 * existing files (e.g. tracked by git) are never overwritten.
 *
 * Copied files are staged (`git add`) so that subsequent `git merge`
 * operations don't fail with "untracked working tree files would be
 * overwritten".
 *
 * @returns the number of files copied.
 */
export function syncUntrackedPaths(repoRoot: string, wtPath: string): number {
  let copied = 0;
  const added: string[] = [];
  for (const entry of WORKTREE_SYNC_PATHS) {
    const srcDir = path.join(repoRoot, entry.dir);
    if (!fs.existsSync(srcDir) || !fs.statSync(srcDir).isDirectory()) { continue; }

    const ext = entry.glob.replace('*', '');          // '*.md' → '.md'
    const files = fs.readdirSync(srcDir).filter(f => f.endsWith(ext));
    if (files.length === 0) { continue; }

    const dstDir = path.join(wtPath, entry.dir);
    if (!fs.existsSync(dstDir)) {
      fs.mkdirSync(dstDir, { recursive: true });
    }
    for (const file of files) {
      const dst = path.join(dstDir, file);
      if (!fs.existsSync(dst)) {
        fs.copyFileSync(path.join(srcDir, file), dst);
        added.push(path.join(entry.dir, file));
        copied++;
      }
    }
  }

  // Stage copied files so git merge won't choke on untracked files.
  if (added.length > 0) {
    execFile('git', ['add', '--', ...added], { cwd: wtPath, timeout: 10_000 }, () => {/* fire-and-forget */});
  }

  return copied;
}

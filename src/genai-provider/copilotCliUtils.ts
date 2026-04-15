/**
 * Pure utility functions for the Copilot CLI provider.
 *
 * Kept in a separate module (no `vscode` dependency) so they can be
 * unit-tested without the VS Code host — same pattern as `squadUtils.ts`.
 */

import { exec } from 'child_process';

/**
 * Prefix appended to the prompt when `/yolo` mode is enabled.
 * Instructs the model to apply all changes without asking for confirmation.
 */
export const YOLO_PREFIX =
  '## /yolo\nApply all changes automatically without asking for confirmation.\n\n';

/**
 * Prefix appended to the prompt when `/fleet` mode is enabled.
 * Instructs the model to optimise for parallel execution.
 */
export const FLEET_PREFIX =
  '## /fleet\nThis task is part of a parallel fleet execution. Focus exclusively on your assigned task, work independently, and avoid conflicts with other sessions.\n\n';

/**
 * Build the optimisation prefix for the given flags.
 *
 * @returns A string to prepend to the prompt, or `''` when both flags are off.
 */
export function buildOptimisationPrefix(yolo: boolean, fleet: boolean): string {
  let prefix = '';
  if (yolo) {
    prefix += YOLO_PREFIX;
  }
  if (fleet) {
    prefix += FLEET_PREFIX;
  }
  return prefix;
}

/**
 * Returns `true` when `cwd` is inside a git repository whose remotes contain `github.com`.
 *
 * Used to guard the `--remote` flag — that flag is only supported by the
 * Copilot CLI when the workspace is backed by a GitHub repository.
 */
export function isGitHubRepository(cwd: string): Promise<boolean> {
  return new Promise<boolean>(resolve => {
    exec('git remote -v', { cwd, timeout: 5_000 }, (err, stdout) => {
      if (err) { resolve(false); return; }
      resolve(/github\.com/i.test(stdout));
    });
  });
}

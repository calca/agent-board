import { ExecFileOptions, execFile } from 'child_process';

/** User login shell (falls back to /bin/zsh → /bin/bash). */
const userShell: string = process.env.SHELL || '/bin/zsh';

/**
 * Escape a single shell argument.
 */
function shellEscape(arg: string): string {
  return `'${arg.replace(/'/g, "'\\''")}'`;
}

/**
 * Build the full command string (single level of escaping)
 * to be passed as the argument of `<shell> -ilc '<cmd> <args…>'`.
 */
function buildShellCmd(cmd: string, args: readonly string[]): string {
  return [cmd, ...args].map(shellEscape).join(' ');
}

/**
 * Thin wrapper around `execFile` that always runs through the user's **login**
 * shell (`-ilc`) so that Homebrew / custom PATH entries are resolved correctly.
 *
 * Uses `execFile(shell, ['-ilc', cmd])` — no intermediate `/bin/sh`, so
 * shell arguments are only escaped once.
 */
export function execShell(
  cmd: string,
  args: readonly string[],
  opts: ExecFileOptions,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(userShell, ['-ilc', buildShellCmd(cmd, args)], opts, (err, stdout, stderr) => {
      if (err) { reject(err); } else { resolve({ stdout: String(stdout), stderr: String(stderr) }); }
    });
  });
}

/**
 * Like `execShell` but resolves `true` / `false` depending on exit code.
 */
export function execShellOk(
  cmd: string,
  args: readonly string[],
  opts: ExecFileOptions = {},
): Promise<boolean> {
  return new Promise((resolve) => {
    execFile(userShell, ['-ilc', buildShellCmd(cmd, args)], opts, (err) => resolve(!err));
  });
}

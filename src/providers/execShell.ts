import { exec, ExecOptions } from 'child_process';

/** User login shell (falls back to /bin/zsh → /bin/bash). */
const userShell: string = process.env.SHELL || '/bin/zsh';

/**
 * Escape a single shell argument.
 */
function shellEscape(arg: string): string {
  return `'${arg.replace(/'/g, "'\\''")}'`;
}

/**
 * Build `<shell> -ilc '<cmd> <args…>'` so the login profile is loaded
 * and Homebrew / custom PATH entries are resolved correctly.
 */
function buildCommand(cmd: string, args: readonly string[]): string {
  const escaped = [cmd, ...args].map(shellEscape).join(' ');
  return `${userShell} -ilc ${shellEscape(escaped)}`;
}

/**
 * Thin wrapper around `exec` that always runs through the user's **login**
 * shell so that Homebrew / custom PATH entries are resolved correctly.
 */
export function execShell(
  cmd: string,
  args: readonly string[],
  opts: ExecOptions,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    exec(buildCommand(cmd, args), opts, (err, stdout, stderr) => {
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
  opts: ExecOptions = {},
): Promise<boolean> {
  return new Promise((resolve) => {
    exec(buildCommand(cmd, args), opts, (err) => resolve(!err));
  });
}

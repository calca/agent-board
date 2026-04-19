/**
 * GitHub authentication helper for the Copilot SDK adapter.
 *
 * Uses the VS Code `authentication` API so the extension never
 * touches tokens directly — the VS Code GitHub auth provider
 * handles secure storage and refresh.
 */
import * as vscode from 'vscode';

/**
 * Obtain a GitHub authentication session with (at least) `read:user` scope.
 *
 * @param createIfNone  When `true`, prompt the user to sign in if no session
 *                      exists.  Pass `false` to check silently.
 * @returns The session, or `undefined` if the user declined.
 */
export async function getGitHubSession(
  createIfNone = true,
): Promise<vscode.AuthenticationSession | undefined> {
  return vscode.authentication.getSession(
    'github',
    ['read:user'],
    { createIfNone },
  );
}

/**
 * Convenience: return just the access token, or `undefined`.
 */
export async function getGitHubToken(
  createIfNone = true,
): Promise<string | undefined> {
  const session = await getGitHubSession(createIfNone);
  return session?.accessToken;
}

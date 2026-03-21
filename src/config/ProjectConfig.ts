import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { ProjectConfigData, extractGitHubConfig } from './configTypes';

export { ProjectConfigData, extractGitHubConfig };

/**
 * Reads per-project configuration from `.agent-board/config.json`
 * in the first workspace folder.
 */
export class ProjectConfig {
  static readonly CONFIG_DIR = '.agent-board';
  static readonly CONFIG_FILE = 'config.json';

  /**
   * Resolve the GitHub `owner` and `repo` from `.agent-board/config.json`.
   */
  static getGitHubConfig(): { owner: string; repo: string } {
    const file = ProjectConfig.readConfigFile();
    return extractGitHubConfig(file);
  }

  /**
   * Return the absolute path to the config file (or `undefined` if no
   * workspace folder is open).
   */
  static configFilePath(): string | undefined {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) {
      return undefined;
    }
    return path.join(
      folders[0].uri.fsPath,
      ProjectConfig.CONFIG_DIR,
      ProjectConfig.CONFIG_FILE,
    );
  }

  // ── internal ──────────────────────────────────────────────────────

  private static readConfigFile(): ProjectConfigData | undefined {
    const filePath = ProjectConfig.configFilePath();
    if (!filePath) {
      return undefined;
    }
    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      return JSON.parse(raw) as ProjectConfigData;
    } catch {
      // File doesn't exist or is invalid JSON — fall through
      return undefined;
    }
  }
}

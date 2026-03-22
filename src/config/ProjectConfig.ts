import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { ProjectConfigData, extractGitHubConfig, resolveConfigValue } from './configTypes';

export { ProjectConfigData, extractGitHubConfig, resolveConfigValue };

/**
 * Reads per-project configuration from `.agent-board/config.json`
 * in the first workspace folder.
 *
 * Every VS Code setting under `agentBoard.*` can be overridden in the
 * project file.  Values in the file take priority over VS Code settings.
 */
export class ProjectConfig {
  static readonly CONFIG_DIR = '.agent-board';
  static readonly CONFIG_FILE = 'config.json';

  /**
   * Resolve the GitHub `owner` and `repo`.
   *
   * Resolution order:
   *   1. `.agent-board/config.json`
   *   2. VS Code settings (`agentBoard.github.owner` / `agentBoard.github.repo`)
   */
  static getGitHubConfig(): { owner: string; repo: string } {
    const file = ProjectConfig.readConfigFile();
    const cfg = vscode.workspace.getConfiguration('agentBoard');
    const settingConfig = {
      owner: cfg.get<string>('github.owner', ''),
      repo: cfg.get<string>('github.repo', ''),
    };
    return extractGitHubConfig(file, settingConfig);
  }

  /**
   * Resolve a single setting: project file value → VS Code setting → default.
   */
  static resolve<T>(fileValue: T | undefined, settingKey: string, defaultValue: T): T {
    const cfg = vscode.workspace.getConfiguration('agentBoard');
    const settingVal = cfg.get<T>(settingKey, defaultValue);
    return resolveConfigValue(fileValue, settingVal);
  }

  /** Read the raw project config (or `undefined` if missing). */
  static getProjectConfig(): ProjectConfigData | undefined {
    return ProjectConfig.readConfigFile();
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

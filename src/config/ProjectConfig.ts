import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { ProjectConfigData, extractGitHubConfig, resolveConfigValue } from './configTypes';
import { Logger } from '../utils/logger';

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
   * Merge a partial update into the config file.
   *
   * Creates the `.agent-board/` directory and `config.json` if they
   * don't exist.  Existing keys are preserved; only the keys in
   * `partial` are overwritten (shallow-merged at the top level, deep-
   * merged one level down for nested objects like `mcp`).
   */
  static updateConfig(partial: Partial<ProjectConfigData>): void {
    const filePath = ProjectConfig.configFilePath();
    if (!filePath) {
      Logger.getInstance().warn('ProjectConfig.updateConfig: no workspace folder, cannot save config');
      return;
    }

    const existing = ProjectConfig.readConfigFile() ?? {};
    Logger.getInstance().debug('ProjectConfig.updateConfig: partial keys=%s, existing keys=%s', Object.keys(partial).join(','), Object.keys(existing).join(','));

    // Shallow-merge top-level keys; for objects, merge one level deeper
    const merged: Record<string, unknown> = { ...existing };
    for (const [key, value] of Object.entries(partial)) {
      if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
        merged[key] = { ...(existing as Record<string, unknown>)[key] as Record<string, unknown> ?? {}, ...value };
      } else {
        merged[key] = value;
      }
    }

    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filePath, JSON.stringify(merged, null, 2), 'utf-8');
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

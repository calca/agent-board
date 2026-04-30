import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

/**
 * Centralised store for per-task local squad-agent overrides.
 *
 * Storage: `.agent-board/local-squad-agent/<provider>/<provider>-<safeId>.json`
 * Format:  `{ "taskId": "<original>", "squadAgent": "agent-slug" }`
 *
 * Used for sync providers (GitHub, AzureDevOps, etc.) that cannot store
 * per-task squad agent in the remote issue.  JSON provider tasks persist
 * the agent directly in their task file via `KanbanTask.squadAgent`.
 */
export class LocalSquadAgentStore {
  private static readonly DIR_NAME = 'local-squad-agent';

  // ── queries ───────────────────────────────────────────────────────

  static get(providerId: string, taskId: string): string | undefined {
    const fp = LocalSquadAgentStore.entryPath(providerId, taskId);
    if (!fp) { return undefined; }
    return LocalSquadAgentStore.readAgent(fp);
  }

  /** Return all stored squad agents as `{ [taskId]: agentSlug }`. */
  static getAll(): Record<string, string> {
    const baseDir = LocalSquadAgentStore.baseDir();
    if (!baseDir || !fs.existsSync(baseDir)) { return {}; }
    const result: Record<string, string> = {};
    try {
      for (const provider of fs.readdirSync(baseDir)) {
        const provDir = path.join(baseDir, provider);
        if (!fs.statSync(provDir).isDirectory()) { continue; }
        for (const file of fs.readdirSync(provDir)) {
          if (!file.endsWith('.json')) { continue; }
          const fp = path.join(provDir, file);
          try {
            const raw = fs.readFileSync(fp, 'utf-8');
            const parsed: unknown = JSON.parse(raw);
            if (!parsed || typeof parsed !== 'object') { continue; }
            const obj = parsed as Record<string, unknown>;
            const taskId = typeof obj.taskId === 'string' ? obj.taskId : undefined;
            const squadAgent = typeof obj.squadAgent === 'string' ? obj.squadAgent : undefined;
            if (taskId && squadAgent) {
              result[taskId] = squadAgent;
            }
          } catch { /* skip corrupt files */ }
        }
      }
    } catch { /* empty */ }
    return result;
  }

  // ── mutations ─────────────────────────────────────────────────────

  static set(providerId: string, taskId: string, agentSlug: string): void {
    const fp = LocalSquadAgentStore.entryPath(providerId, taskId);
    if (!fp) { return; }
    const trimmed = agentSlug.trim();
    if (!trimmed) {
      LocalSquadAgentStore.delete(providerId, taskId);
      return;
    }
    const dir = path.dirname(fp);
    if (!fs.existsSync(dir)) { fs.mkdirSync(dir, { recursive: true }); }
    fs.writeFileSync(fp, JSON.stringify({ taskId, squadAgent: trimmed }, null, 2), 'utf-8');
  }

  static delete(providerId: string, taskId: string): void {
    const fp = LocalSquadAgentStore.entryPath(providerId, taskId);
    if (!fp) { return; }
    try { fs.unlinkSync(fp); } catch { /* already gone */ }
  }

  // ── internal ──────────────────────────────────────────────────────

  private static baseDir(): string | undefined {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) { return undefined; }
    return path.join(folders[0].uri.fsPath, '.agent-board', LocalSquadAgentStore.DIR_NAME);
  }

  private static entryPath(providerId: string, taskId: string): string | undefined {
    const base = LocalSquadAgentStore.baseDir();
    if (!base) { return undefined; }
    const safeProvider = providerId.replace(/[^a-zA-Z0-9_-]/g, '_');
    const safeId = String(taskId).replace(/[^a-zA-Z0-9_.-]/g, '_');
    return path.join(base, safeProvider, `${safeProvider}-${safeId}.json`);
  }

  private static readAgent(fp: string): string | undefined {
    try {
      const raw = fs.readFileSync(fp, 'utf-8');
      const obj = JSON.parse(raw) as Record<string, unknown>;
      const squadAgent = obj?.squadAgent;
      return typeof squadAgent === 'string' && squadAgent ? squadAgent : undefined;
    } catch {
      return undefined;
    }
  }
}

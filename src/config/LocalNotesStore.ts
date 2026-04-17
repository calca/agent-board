import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

/**
 * Centralised store for per-task local notes.
 *
 * Storage: `.agent-board/local-notes/<provider>/<provider>-<safeId>.json`
 * Format:  `{ "taskId": "<original>", "notes": "…" }`
 *
 * The original `taskId` is always stored inside the file so `getAll()`
 * never needs to reverse-engineer the filename sanitisation.
 */
export class LocalNotesStore {
  private static readonly DIR_NAME = 'local-notes';

  // ── queries ───────────────────────────────────────────────────────

  static get(providerId: string, taskId: string): string | undefined {
    const fp = LocalNotesStore.notePath(providerId, taskId);
    if (!fp) { return undefined; }
    return LocalNotesStore.readNotes(fp);
  }

  /** Return all stored notes as `{ [taskId]: noteString }`. */
  static getAll(): Record<string, string> {
    const baseDir = LocalNotesStore.baseDir();
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
            const notes = typeof obj.notes === 'string' ? obj.notes : undefined;
            if (taskId && notes) {
              result[taskId] = notes;
            }
          } catch { /* skip corrupt files */ }
        }
      }
    } catch { /* empty */ }
    return result;
  }

  // ── mutations ─────────────────────────────────────────────────────

  static set(providerId: string, taskId: string, notes: string): void {
    const fp = LocalNotesStore.notePath(providerId, taskId);
    if (!fp) { return; }
    const trimmed = notes.trim();
    if (!trimmed) {
      LocalNotesStore.delete(providerId, taskId);
      return;
    }
    const dir = path.dirname(fp);
    if (!fs.existsSync(dir)) { fs.mkdirSync(dir, { recursive: true }); }
    fs.writeFileSync(fp, JSON.stringify({ taskId, notes: trimmed }, null, 2), 'utf-8');
  }

  static delete(providerId: string, taskId: string): void {
    const fp = LocalNotesStore.notePath(providerId, taskId);
    if (!fp) { return; }
    try { fs.unlinkSync(fp); } catch { /* already gone */ }
  }

  // ── internal ──────────────────────────────────────────────────────

  private static baseDir(): string | undefined {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) { return undefined; }
    return path.join(folders[0].uri.fsPath, '.agent-board', LocalNotesStore.DIR_NAME);
  }

  private static notePath(providerId: string, taskId: string): string | undefined {
    const base = LocalNotesStore.baseDir();
    if (!base) { return undefined; }
    const safeProvider = providerId.replace(/[^a-zA-Z0-9_-]/g, '_');
    const safeId = String(taskId).replace(/[^a-zA-Z0-9_.-]/g, '_');
    return path.join(base, safeProvider, `${safeProvider}-${safeId}.json`);
  }

  private static readNotes(fp: string): string | undefined {
    try {
      const raw = fs.readFileSync(fp, 'utf-8');
      const obj = JSON.parse(raw) as Record<string, unknown>;
      const notes = obj?.notes;
      return typeof notes === 'string' && notes ? notes : undefined;
    } catch {
      return undefined;
    }
  }
}

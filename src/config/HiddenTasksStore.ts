import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import type { KanbanTask } from '../types/KanbanTask';

/**
 * Centralised store for hidden task IDs.
 *
 * Persisted in `.agent-board/hidden-tasks.list.json` — a plain JSON
 * array of task-ID strings.  Kept separate from the project config
 * because it is user-local workspace state, not project configuration.
 */
export class HiddenTasksStore {
  private static readonly FILE_NAME = 'hidden-tasks.list.json';

  // ── queries ───────────────────────────────────────────────────────

  /** Return the set of currently hidden task IDs. */
  static getIds(): Set<string> {
    return new Set(HiddenTasksStore.read());
  }

  /** Check whether a single task is hidden. */
  static isHidden(taskId: string): boolean {
    return HiddenTasksStore.read().includes(taskId);
  }

  /**
   * Return only the visible (non-hidden) tasks from `tasks`.
   * This is the single filter that every consumer should use.
   */
  static filterVisible<T extends { id: string }>(tasks: T[]): T[] {
    const hidden = HiddenTasksStore.getIds();
    return tasks.filter(t => !hidden.has(t.id));
  }

  // ── mutations ─────────────────────────────────────────────────────

  /** Hide a single task. No-op if already hidden. */
  static hide(taskId: string): void {
    const ids = HiddenTasksStore.read();
    if (!ids.includes(taskId)) {
      ids.push(taskId);
      HiddenTasksStore.write(ids);
    }
  }

  /** Hide multiple tasks at once. */
  static hideMany(taskIds: string[]): void {
    const ids = HiddenTasksStore.read();
    const existing = new Set(ids);
    let changed = false;
    for (const id of taskIds) {
      if (!existing.has(id)) {
        ids.push(id);
        existing.add(id);
        changed = true;
      }
    }
    if (changed) {
      HiddenTasksStore.write(ids);
    }
  }

  /** Unhide a single task. No-op if not hidden. */
  static unhide(taskId: string): void {
    const ids = HiddenTasksStore.read();
    const idx = ids.indexOf(taskId);
    if (idx !== -1) {
      ids.splice(idx, 1);
      HiddenTasksStore.write(ids);
    }
  }

  /** Remove all hidden IDs. */
  static clear(): void {
    HiddenTasksStore.write([]);
  }

  // ── internal ──────────────────────────────────────────────────────

  /** Absolute path to the hidden-tasks list file (or `undefined`). */
  static filePath(): string | undefined {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) { return undefined; }
    return path.join(folders[0].uri.fsPath, '.agent-board', HiddenTasksStore.FILE_NAME);
  }

  private static read(): string[] {
    const fp = HiddenTasksStore.filePath();
    if (!fp) { return []; }
    try {
      const raw = fs.readFileSync(fp, 'utf-8');
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.every(v => typeof v === 'string')) {
        return parsed as string[];
      }
      return [];
    } catch {
      return [];
    }
  }

  private static write(ids: string[]): void {
    const fp = HiddenTasksStore.filePath();
    if (!fp) { return; }
    const dir = path.dirname(fp);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(fp, JSON.stringify(ids, null, 2), 'utf-8');
  }
}

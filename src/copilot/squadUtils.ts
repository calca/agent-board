/**
 * Pure helper functions for squad session management.
 * These are free of VS Code dependencies and testable in any context.
 */

import { ColumnId } from '../types/ColumnId';
import { KanbanTask } from '../types/KanbanTask';

/** Default maximum parallel sessions when not configured. */
export const DEFAULT_MAX_SESSIONS = 10;

/** Default column from which the squad picks tasks to launch. */
export const DEFAULT_SOURCE_COLUMN: ColumnId = 'todo';

/** Default column tasks are moved to when the agent starts working. */
export const DEFAULT_ACTIVE_COLUMN: ColumnId = 'inprogress';

/** Default column tasks are moved to when the agent completes. */
export const DEFAULT_DONE_COLUMN: ColumnId = 'review';

/** Default auto-squad poll interval in milliseconds (15 s). */
export const DEFAULT_AUTO_SQUAD_INTERVAL = 15_000;

/** Default maximum retries for a failed session (0 = no retry). */
export const DEFAULT_MAX_RETRIES = 0;

/** Default session timeout in milliseconds (5 minutes). 0 = no timeout. */
export const DEFAULT_SESSION_TIMEOUT = 300_000;

/** Default cooldown between consecutive session launches in milliseconds. 0 = no cooldown. */
export const DEFAULT_COOLDOWN_MS = 0;

/**
 * Compute how many new sessions can be launched.
 */
export function computeAvailableSlots(activeCount: number, maxSessions: number): number {
  return Math.max(0, maxSessions - activeCount);
}

/**
 * Determine whether a task can be retried given its current attempt
 * count and the configured maximum retries.
 */
export function canRetry(attempt: number, maxRetries: number): boolean {
  return maxRetries > 0 && attempt < maxRetries;
}

/**
 * Sort tasks by label-based priority.
 *
 * `priorityLabels` is an ordered list of label strings; tasks whose
 * labels contain an earlier entry in the list sort first.  Tasks with
 * no matching label sort last (preserving their relative order).
 */
export function sortByPriority(tasks: KanbanTask[], priorityLabels: string[]): KanbanTask[] {
  if (priorityLabels.length === 0) {
    return tasks;
  }

  const priority = (task: KanbanTask): number => {
    for (let i = 0; i < priorityLabels.length; i++) {
      if (task.labels.some(l => l.toLowerCase() === priorityLabels[i].toLowerCase())) {
        return i;
      }
    }
    return priorityLabels.length; // no matching label → lowest priority
  };

  return [...tasks].sort((a, b) => priority(a) - priority(b));
}

/**
 * Determine whether a session has exceeded the configured timeout.
 *
 * @param startedAt  ISO timestamp when the session started.
 * @param timeoutMs  Maximum allowed duration in milliseconds. 0 means no timeout.
 * @param now        Current time (injectable for testing).
 */
export function isTimedOut(startedAt: string, timeoutMs: number, now: Date = new Date()): boolean {
  if (timeoutMs <= 0) {
    return false;
  }
  const elapsed = now.getTime() - new Date(startedAt).getTime();
  return elapsed >= timeoutMs;
}

/**
 * Determine whether a task should be excluded based on its labels.
 *
 * Returns `true` when the task has *any* label that appears in the
 * `excludeLabels` list (case-insensitive).
 */
export function shouldExclude(taskLabels: string[], excludeLabels: string[]): boolean {
  if (excludeLabels.length === 0) {
    return false;
  }
  const lower = excludeLabels.map(l => l.toLowerCase());
  return taskLabels.some(l => lower.includes(l.toLowerCase()));
}

/**
 * Determine whether a task matches the assignee filter.
 *
 * - Empty `filter` → matches every task (no filtering).
 * - `"*"` → matches tasks that have *any* assignee (skip unassigned).
 * - `"unassigned"` → matches tasks with no assignee.
 * - Any other value → matches tasks whose `assignee` equals `filter`
 *   (case-insensitive).
 */
export function matchesAssignee(taskAssignee: string | undefined, filter: string): boolean {
  if (!filter) {
    return true; // no filter → all tasks
  }
  if (filter === '*') {
    return !!taskAssignee;
  }
  if (filter.toLowerCase() === 'unassigned') {
    return !taskAssignee;
  }
  return (taskAssignee ?? '').toLowerCase() === filter.toLowerCase();
}

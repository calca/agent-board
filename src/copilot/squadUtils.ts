/**
 * Pure helper functions for squad session management.
 * These are free of VS Code dependencies and testable in any context.
 */

import { ColumnId } from '../types/ColumnId';

/** Default maximum parallel sessions when not configured. */
export const DEFAULT_MAX_SESSIONS = 10;

/** Default column from which the squad picks tasks to launch. */
export const DEFAULT_SOURCE_COLUMN: ColumnId = 'todo';

/** Default column tasks are moved to when the agent starts working. */
export const DEFAULT_ACTIVE_COLUMN: ColumnId = 'inprogress';

/** Default column tasks are moved to when the agent completes. */
export const DEFAULT_DONE_COLUMN: ColumnId = 'review';

/**
 * Compute how many new sessions can be launched.
 */
export function computeAvailableSlots(activeCount: number, maxSessions: number): number {
  return Math.max(0, maxSessions - activeCount);
}

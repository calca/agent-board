/**
 * Kanban column identifier.
 *
 * The first column is always `todo` and the last is always `done`.
 * Only the intermediate columns are configurable via
 * `kanban.intermediateColumns` in the project config.
 * The type is `string` to allow arbitrary column names;
 * {@link DEFAULT_COLUMN_IDS} provides the built-in defaults.
 */
export type ColumnId = string;

/** Fixed first column. */
export const FIRST_COLUMN = 'todo';
/** Fixed last column. */
export const LAST_COLUMN = 'done';

/** Default intermediate column identifiers (between todo and done). */
export const DEFAULT_INTERMEDIATE_IDS: readonly string[] = ['inprogress', 'review'] as const;

/** Built-in default column identifiers. */
export const DEFAULT_COLUMN_IDS: readonly string[] = [FIRST_COLUMN, ...DEFAULT_INTERMEDIATE_IDS, LAST_COLUMN] as const;

/** Default display labels for the built-in columns. */
export const DEFAULT_COLUMN_LABELS: Record<string, string> = {
  todo: 'To Do',
  inprogress: 'In Progress',
  review: 'Review',
  done: 'Done',
};

/** Default background colours for the built-in columns (hex, applied at 20% opacity). */
export const DEFAULT_COLUMN_COLORS: Record<string, string> = {
  todo: '#888888',
  inprogress: '#0078d4',
  review: '#d9a500',
  done: '#16825d',
};

/**
 * Build the full ordered column list from intermediate columns.
 * Always prepends `todo` and appends `done`.
 */
export function buildColumnOrder(intermediateColumns?: string[]): string[] {
  const middle = intermediateColumns?.length ? intermediateColumns : [...DEFAULT_INTERMEDIATE_IDS];
  return [FIRST_COLUMN, ...middle, LAST_COLUMN];
}


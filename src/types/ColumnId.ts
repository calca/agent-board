/**
 * Kanban column identifier.
 *
 * Columns are fully configurable via `kanban.columns` in the project
 * config.  The type is `string` to allow arbitrary column names;
 * {@link DEFAULT_COLUMN_IDS} provides the built-in defaults.
 */
export type ColumnId = string;

/** Built-in default column identifiers. */
export const DEFAULT_COLUMN_IDS: readonly string[] = ['todo', 'inprogress', 'review', 'done'] as const;

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


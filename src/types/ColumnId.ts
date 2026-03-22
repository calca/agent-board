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

/**
 * @deprecated Use {@link DEFAULT_COLUMN_IDS} instead.  Kept temporarily
 * for internal references during migration.
 */
export const COLUMN_IDS: readonly string[] = DEFAULT_COLUMN_IDS;

/** Default display labels for the built-in columns. */
export const DEFAULT_COLUMN_LABELS: Record<string, string> = {
  todo: 'To Do',
  inprogress: 'In Progress',
  review: 'Review',
  done: 'Done',
};

/**
 * @deprecated Use {@link DEFAULT_COLUMN_LABELS} instead.
 */
export const COLUMN_LABELS: Record<string, string> = DEFAULT_COLUMN_LABELS;

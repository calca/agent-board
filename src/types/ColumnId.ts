/**
 * Kanban column identifiers.
 * Maps to the configurable columns displayed on the board.
 */
export type ColumnId = 'todo' | 'inprogress' | 'review' | 'done';

export const COLUMN_IDS: readonly ColumnId[] = ['todo', 'inprogress', 'review', 'done'] as const;

export const COLUMN_LABELS: Record<ColumnId, string> = {
  todo: 'To Do',
  inprogress: 'In Progress',
  review: 'Review',
  done: 'Done',
};

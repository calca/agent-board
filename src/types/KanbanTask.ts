import { ColumnId } from './ColumnId';

/**
 * Normalised task representation shared across all providers.
 * The `id` field uses the format `{providerId}:{nativeId}`.
 */
export interface KanbanTask {
  id: string;
  title: string;
  body: string;
  status: ColumnId;
  labels: string[];
  assignee?: string;
  url?: string;
  providerId: string;
  createdAt?: Date;
  meta: Record<string, unknown>;
}

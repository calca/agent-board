import * as vscode from 'vscode';
import { KanbanTask } from '../types/KanbanTask';

/**
 * Contract that every task data source must implement.
 * Providers are registered in `ProviderRegistry` and consumed by the
 * Kanban panel and the Copilot launcher — never imported directly.
 */
export interface ITaskProvider {
  readonly id: string;
  readonly displayName: string;
  /** `vscode.ThemeIcon` identifier, e.g. `'github'` or `'file-code'`. */
  readonly icon: string;

  getTasks(): Promise<KanbanTask[]>;
  updateTask(task: KanbanTask): Promise<void>;
  refresh(): Promise<void>;
  dispose(): void;

  readonly onDidChangeTasks: vscode.Event<KanbanTask[]>;
}

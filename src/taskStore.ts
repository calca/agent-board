import * as vscode from 'vscode';
import { Task, TaskStatus } from './types';

export class TaskStore {
  private static readonly STORAGE_KEY = 'agentBoard.tasks';
  private tasks: Task[] = [];

  constructor(private readonly context: vscode.ExtensionContext) {
    this.tasks = context.workspaceState.get<Task[]>(TaskStore.STORAGE_KEY, []);
  }

  getTasks(): Task[] {
    return [...this.tasks];
  }

  getTask(id: string): Task | undefined {
    return this.tasks.find(t => t.id === id);
  }

  addTask(title: string, description?: string): Task {
    const task: Task = {
      id: this.generateId(),
      title,
      description,
      status: 'pending',
      createdAt: new Date().toISOString(),
    };
    this.tasks.push(task);
    this.persist();
    return task;
  }

  updateTask(id: string, updates: Partial<Pick<Task, 'title' | 'description' | 'status' | 'agentId'>>): Task | undefined {
    const index = this.tasks.findIndex(t => t.id === id);
    if (index === -1) {
      return undefined;
    }
    const task = { ...this.tasks[index], ...updates };
    if (updates.status === 'completed' && !task.completedAt) {
      task.completedAt = new Date().toISOString();
    }
    this.tasks[index] = task;
    this.persist();
    return task;
  }

  completeTask(id: string): Task | undefined {
    return this.updateTask(id, { status: 'completed' });
  }

  deleteTask(id: string): boolean {
    const index = this.tasks.findIndex(t => t.id === id);
    if (index === -1) {
      return false;
    }
    this.tasks.splice(index, 1);
    this.persist();
    return true;
  }

  getTasksByStatus(status: TaskStatus): Task[] {
    return this.tasks.filter(t => t.status === status);
  }

  private generateId(): string {
    return `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  private persist(): void {
    this.context.workspaceState.update(TaskStore.STORAGE_KEY, this.tasks);
  }
}

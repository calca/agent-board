import * as vscode from 'vscode';
import { Task } from './types';
import { TaskStore } from './taskStore';

export class TaskTreeItem extends vscode.TreeItem {
  constructor(public readonly task: Task) {
    super(task.title, vscode.TreeItemCollapsibleState.None);

    this.id = task.id;
    this.tooltip = task.description ?? task.title;
    this.description = task.status === 'completed' ? '✓ done' : 'pending';

    this.contextValue = `task-${task.status}`;

    this.iconPath = new vscode.ThemeIcon(
      task.status === 'completed' ? 'pass-filled' : 'circle-large-outline',
      task.status === 'completed'
        ? new vscode.ThemeColor('terminal.ansiGreen')
        : new vscode.ThemeColor('foreground'),
    );
  }
}

export class TasksTreeProvider implements vscode.TreeDataProvider<TaskTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<TaskTreeItem | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private readonly taskStore: TaskStore) {}

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: TaskTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(): TaskTreeItem[] {
    const pending = this.taskStore.getTasksByStatus('pending').map(t => new TaskTreeItem(t));
    const completed = this.taskStore.getTasksByStatus('completed').map(t => new TaskTreeItem(t));
    return [...pending, ...completed];
  }
}

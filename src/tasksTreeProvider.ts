import * as vscode from 'vscode';
import { KanbanTask } from './types/KanbanTask';
import { ITaskProvider } from './providers/ITaskProvider';

export class TaskTreeItem extends vscode.TreeItem {
  constructor(public readonly task: KanbanTask) {
    super(task.title, vscode.TreeItemCollapsibleState.None);

    this.id = task.id;
    this.tooltip = task.body || task.title;
    this.description = task.status === 'done' ? '✓ done' : task.status;

    this.contextValue = task.status === 'done' ? 'task-completed' : 'task-pending';

    this.iconPath = new vscode.ThemeIcon(
      task.status === 'done' ? 'pass-filled' : 'circle-large-outline',
      task.status === 'done'
        ? new vscode.ThemeColor('terminal.ansiGreen')
        : new vscode.ThemeColor('foreground'),
    );
  }
}

export class TasksTreeProvider implements vscode.TreeDataProvider<TaskTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<TaskTreeItem | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private readonly provider: ITaskProvider) {
    provider.onDidChangeTasks(() => this._onDidChangeTreeData.fire());
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: TaskTreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(): Promise<TaskTreeItem[]> {
    const tasks = await this.provider.getTasks();
    return tasks
      .sort((a, b) => {
        if (a.status === 'done' && b.status !== 'done') { return 1; }
        if (a.status !== 'done' && b.status === 'done') { return -1; }
        const aTime = a.createdAt?.getTime() ?? 0;
        const bTime = b.createdAt?.getTime() ?? 0;
        return bTime - aTime;
      })
      .map(t => new TaskTreeItem(t));
  }
}

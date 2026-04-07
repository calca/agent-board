import * as vscode from 'vscode';
import { SquadManager } from './copilot/SquadManager';
import { ProviderRegistry } from './providers/ProviderRegistry';
import { COLUMN_LABELS } from './types/ColumnId';
import { KanbanTask } from './types/KanbanTask';

export class OverviewItem extends vscode.TreeItem {
  constructor(
    label: string,
    description: string,
    icon: vscode.ThemeIcon,
    command?: vscode.Command,
  ) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.description = description;
    this.iconPath = icon;
    if (command) {
      this.command = command;
    }
  }
}

/** Compact sidebar overview — task counts per column + sessions. */
export class OverviewTreeProvider implements vscode.TreeDataProvider<OverviewItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(
    private readonly providerRegistry: ProviderRegistry,
    private readonly squadManager?: SquadManager,
  ) {}

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: OverviewItem): vscode.TreeItem {
    return element;
  }

  async getChildren(): Promise<OverviewItem[]> {
    const items: OverviewItem[] = [];

    const providers = this.providerRegistry.getAll();
    const allTasks: KanbanTask[] = (
      await Promise.allSettled(providers.map(p => p.getTasks()))
    )
      .filter((r): r is PromiseFulfilledResult<KanbanTask[]> => r.status === 'fulfilled')
      .flatMap(r => r.value);

    const counts = new Map<string, number>();
    for (const t of allTasks) {
      counts.set(t.status, (counts.get(t.status) ?? 0) + 1);
    }

    // ── Open Kanban (first!) ──────────────────────────────────────────
    items.push(new OverviewItem(
      'Open Kanban Board',
      '',
      new vscode.ThemeIcon('layout', new vscode.ThemeColor('terminal.ansiCyan')),
      { command: 'agentBoard.openKanban', title: 'Open Kanban Board' },
    ));

    // ── Separator ─────────────────────────────────────────────────────
    items.push(new OverviewItem(
      'Tasks',
      `${allTasks.length} total`,
      new vscode.ThemeIcon('pulse', new vscode.ThemeColor('foreground')),
    ));

    // ── Column counts ─────────────────────────────────────────────────
    const iconMap: Record<string, string> = {
      todo: 'record',
      inprogress: 'play-circle',
      review: 'eye',
      done: 'check',
    };
    const colorMap: Record<string, string> = {
      todo: 'charts.foreground',
      inprogress: 'terminal.ansiBlue',
      review: 'terminal.ansiYellow',
      done: 'terminal.ansiGreen',
    };

    for (const [colId, colLabel] of Object.entries(COLUMN_LABELS)) {
      const count = counts.get(colId) ?? 0;
      const bar = count > 0 ? '\u2588'.repeat(Math.min(count, 12)) : '\u2500';
      items.push(new OverviewItem(
        `  ${colLabel}`,
        `${bar}  ${count}`,
        new vscode.ThemeIcon(
          iconMap[colId] ?? 'circle-large-outline',
          new vscode.ThemeColor(colorMap[colId] ?? 'foreground'),
        ),
      ));
    }

    // ── Sessions ──────────────────────────────────────────────────────
    if (this.squadManager) {
      const s = this.squadManager.getStatus();
      items.push(new OverviewItem(
        '$(dash)  Sessions',
        `${s.activeCount} active`,
        new vscode.ThemeIcon(
          s.activeCount > 0 ? 'vm-running' : 'vm-outline',
          s.activeCount > 0
            ? new vscode.ThemeColor('terminal.ansiGreen')
            : new vscode.ThemeColor('foreground'),
        ),
      ));
    }

    return items;
  }
}

import * as vscode from 'vscode';
import { AgentManager } from './agentManager';
import type { Agent } from './types/Agent';

export class AgentTreeItem extends vscode.TreeItem {
  constructor(public readonly agent: Agent) {
    super(agent.name, vscode.TreeItemCollapsibleState.None);

    this.id = agent.id;
    this.tooltip = agent.output ?? agent.name;
    this.description = agent.status;

    this.contextValue = `agent-${agent.status}`;

    const iconMap: Record<Agent['status'], string> = {
      idle: 'circle-large-outline',
      running: 'sync~spin',
      completed: 'pass-filled',
      failed: 'error',
    };
    const colorMap: Record<Agent['status'], string> = {
      idle: 'foreground',
      running: 'terminal.ansiBlue',
      completed: 'terminal.ansiGreen',
      failed: 'terminal.ansiRed',
    };

    this.iconPath = new vscode.ThemeIcon(
      iconMap[agent.status],
      new vscode.ThemeColor(colorMap[agent.status]),
    );
  }
}

export class AgentsTreeProvider implements vscode.TreeDataProvider<AgentTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<AgentTreeItem | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private readonly agentManager: AgentManager) {}

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: AgentTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(): AgentTreeItem[] {
    return this.agentManager.getAgents().map(a => new AgentTreeItem(a));
  }
}

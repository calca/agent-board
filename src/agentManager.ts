import * as vscode from 'vscode';
import { Agent, AgentStatus } from './types';
import { ProviderRegistry } from './providers/ProviderRegistry';

export class AgentManager {
  private static readonly STORAGE_KEY = 'agentBoard.agents';
  private agents: Agent[] = [];

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly providerRegistry: ProviderRegistry,
  ) {
    this.agents = context.workspaceState.get<Agent[]>(AgentManager.STORAGE_KEY, []);
    // Reset any agents that were running when VS Code was closed
    this.agents = this.agents.map(a =>
      a.status === 'running' ? { ...a, status: 'failed', finishedAt: new Date().toISOString() } : a,
    );
    this.persist();
  }

  getAgents(): Agent[] {
    return [...this.agents];
  }

  getAgent(id: string): Agent | undefined {
    return this.agents.find(a => a.id === id);
  }

  createAgent(name: string, taskId?: string): Agent {
    const agent: Agent = {
      id: this.generateId(),
      name,
      status: 'idle',
      taskId,
    };
    this.agents.push(agent);
    this.persist();
    return agent;
  }

  startAgent(id: string): Agent | undefined {
    const index = this.agents.findIndex(a => a.id === id);
    if (index === -1) {
      return undefined;
    }
    const agent = this.agents[index];
    if (agent.status !== 'idle') {
      return undefined;
    }
    this.agents[index] = {
      ...agent,
      status: 'running',
      startedAt: new Date().toISOString(),
      output: '',
    };
    this.persist();
    return this.agents[index];
  }

  stopAgent(id: string): Agent | undefined {
    const index = this.agents.findIndex(a => a.id === id);
    if (index === -1) {
      return undefined;
    }
    const agent = this.agents[index];
    if (agent.status !== 'running') {
      return undefined;
    }
    this.agents[index] = {
      ...agent,
      status: 'failed',
      finishedAt: new Date().toISOString(),
    };
    this.persist();
    return this.agents[index];
  }

  completeAgent(id: string, output: string): Agent | undefined {
    const index = this.agents.findIndex(a => a.id === id);
    if (index === -1) {
      return undefined;
    }
    const agent = this.agents[index];
    this.agents[index] = {
      ...agent,
      status: 'completed',
      finishedAt: new Date().toISOString(),
      output,
    };
    // Complete the associated task via the owning provider
    if (agent.taskId) {
      this.providerRegistry.resolveTask(agent.taskId).then(resolved => {
        if (resolved) {
          resolved.provider.updateTask({ ...resolved.task, status: 'done' });
        }
      });
    }
    this.persist();
    return this.agents[index];
  }

  deleteAgent(id: string): boolean {
    const index = this.agents.findIndex(a => a.id === id);
    if (index === -1) {
      return false;
    }
    this.agents.splice(index, 1);
    this.persist();
    return true;
  }

  getAgentsByStatus(status: AgentStatus): Agent[] {
    return this.agents.filter(a => a.status === status);
  }

  private generateId(): string {
    return `agent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  private persist(): void {
    this.context.workspaceState.update(AgentManager.STORAGE_KEY, this.agents);
  }
}

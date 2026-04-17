export type AgentStatus = 'idle' | 'running' | 'completed' | 'failed';

export interface Agent {
  id: string;
  name: string;
  status: AgentStatus;
  taskId?: string;
  startedAt?: string;
  finishedAt?: string;
  output?: string;
}

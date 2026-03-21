export type TaskStatus = 'pending' | 'completed';
export type AgentStatus = 'idle' | 'running' | 'completed' | 'failed';

export interface Task {
  id: string;
  title: string;
  description?: string;
  status: TaskStatus;
  createdAt: string;
  completedAt?: string;
  agentId?: string;
}

export interface Agent {
  id: string;
  name: string;
  status: AgentStatus;
  taskId?: string;
  startedAt?: string;
  finishedAt?: string;
  output?: string;
}

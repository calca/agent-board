/**
 * DataProvider — abstraction layer over transport medium.
 *
 * In VSCode WebView: uses postMessage (acquireVsCodeApi)
 * In browser mobile: uses fetch (HTTP REST API)
 *
 * This allows the same React components to work in both environments.
 */

import { getVsCodeApi } from './hooks/useVsCodeApi';
import { transport } from './transport';

type ColumnId = string;

/** Simplified task representation for cross-environment communication. */
export interface Task {
  id: string;
  title: string;
  body: string;
  status: ColumnId;
  labels: string[];
  assignee?: string;
  url?: string;
  providerId: string;
  createdAt?: string; // ISO string
  agent?: string;
  meta?: Record<string, unknown>;
}

/** Environment type detected at runtime. */
type Environment = 'vscode' | 'browser';

/**
 * Detects the runtime environment.
 * Returns 'vscode' if acquireVsCodeApi is available, 'browser' otherwise.
 */
function detectEnvironment(): Environment {
  return typeof (globalThis as any).acquireVsCodeApi !== 'undefined' ? 'vscode' : 'browser';
}

/**
 * Gets the base URL for the mobile HTTP API.
 * In browser context, this is the current window origin.
 */
function getApiBaseUrl(): string {
  return typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3333';
}

let nextRequestId = 0;
function makeRequestId(): string {
  return `req-${Date.now()}-${nextRequestId++}`;
}

class DataProviderImpl {
  private environment: Environment;
  private vsCodeApi: { postMessage(msg: unknown): void } | null;

  constructor() {
    this.environment = detectEnvironment();
    this.vsCodeApi = getVsCodeApi();
  }

  /**
   * Fetch all tasks from the source (VSCode or HTTP API).
   */
  async getTasks(): Promise<Task[]> {
    if (this.environment === 'vscode' && this.vsCodeApi) {
      return this.getTasksFromVsCode();
    } else {
      return this.getTasksFromApi();
    }
  }

  /**
   * Update task status (move between columns).
   */
  async updateTaskStatus(id: string, status: ColumnId, providerId: string): Promise<void> {
    transport.send({
      type: 'taskMoved',
      taskId: id,
      providerId,
      toCol: status,
      index: 0,
    });
  }

  /**
   * Create a new task.
   */
  async createTask(task: Omit<Task, 'id'>): Promise<Task> {
    if (this.environment === 'vscode' && this.vsCodeApi) {
      return this.createTaskViaVsCode(task);
    } else {
      return this.createTaskViaApi(task);
    }
  }

  // ── Agent communication ────────────────────────────────────────────

  /** Start an agent run for a task. */
  startAgent(taskId: string, provider: string, prompt: string): void {
    transport.send({ type: 'startAgent', taskId, provider, prompt });
  }

  /** Cancel a running agent. */
  cancelAgent(taskId: string): void {
    transport.send({ type: 'cancelAgent', taskId });
  }

  /**
   * Subscribe to `agentLog` push events for a specific task.
   * Returns an unsubscribe function.
   */
  onAgentLog(taskId: string, callback: (chunk: string, done: boolean) => void): () => void {
    return transport.onPush((msg) => {
      if (msg.type === 'agentLog' && msg.taskId === taskId) {
        callback(msg.chunk, msg.done);
      }
    });
  }

  /**
   * Subscribe to `agentError` push events for a specific task.
   * Returns an unsubscribe function.
   */
  onAgentError(taskId: string, callback: (error: string) => void): () => void {
    return transport.onPush((msg) => {
      if (msg.type === 'agentError' && msg.taskId === taskId) {
        callback(msg.error);
      }
    });
  }

  /**
   * Subscribe to `tasksUpdate` push events.
   * Returns an unsubscribe function.
   */
  onTasksUpdate(callback: (msg: any) => void): () => void {
    return transport.onPush((msg) => {
      if (msg.type === 'tasksUpdate') {
        callback(msg);
      }
    });
  }

  // ── VSCode Communication ────────────────────────────────────────────

  private getTasksFromVsCode(): Promise<Task[]> {
    const requestId = makeRequestId();
    return transport.request<{ tasks: Task[] }>(
      { type: 'requestTasks', requestId },
      'tasksResponse',
      5000,
    ).then(r => r.tasks).catch(() => []);
  }

  private createTaskViaVsCode(task: Omit<Task, 'id'>): Promise<Task> {
    transport.send({
      type: 'saveTask',
      data: {
        title: task.title,
        body: task.body,
        status: task.status,
        labels: task.labels?.join(',') ?? '',
        assignee: task.assignee ?? '',
      },
    });

    // Return a placeholder task (the actual task will come via tasksUpdate)
    return Promise.resolve({
      ...task,
      id: `${task.providerId}:pending-${Date.now()}`,
    });
  }

  // ── HTTP API Communication ────────────────────────────────────────────

  private async getTasksFromApi(): Promise<Task[]> {
    const response = await fetch(`${getApiBaseUrl()}/tasks`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });
    if (!response.ok) {
      throw new Error(`Failed to fetch tasks: ${response.statusText}`);
    }
    return response.json();
  }

  private async createTaskViaApi(task: Omit<Task, 'id'>): Promise<Task> {
    try {
      const response = await fetch(`${getApiBaseUrl()}/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(task),
      });
      if (!response.ok) {
        throw new Error(`Failed to create task: ${response.statusText}`);
      }
      return response.json();
    } catch (error) {
      console.error('Error creating task:', error);
      throw error;
    }
  }
}

/** Singleton instance of DataProvider. */
export const DataProvider = new DataProviderImpl();

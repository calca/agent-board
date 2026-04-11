/**
 * DataProvider — abstraction layer over transport medium.
 * 
 * In VSCode WebView: uses postMessage (acquireVsCodeApi)
 * In browser mobile: uses fetch (HTTP REST API)
 * 
 * This allows the same React components to work in both environments.
 */

import { getVsCodeApi } from './hooks/useVsCodeApi';

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
  // In VSCode WebView, acquireVsCodeApi is injected at runtime
  return typeof (globalThis as any).acquireVsCodeApi !== 'undefined' ? 'vscode' : 'browser';
}

/**
 * Gets the base URL for the mobile HTTP API.
 * In browser context, this is the current window origin.
 */
function getApiBaseUrl(): string {
  return typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3333';
}

/**
 * Message sent from WebView to VSCode host to request task update.
 */
interface RequestTasksMessage {
  type: 'requestTasks';
}

/**
 * Message sent from VSCode host to WebView with task data.
 */
interface TasksResponseMessage {
  type: 'tasksResponse';
  tasks: Task[];
}

/** Global promise resolvers for awaiting responses. */
const responseResolvers = new Map<string, (value: any) => void>();

class DataProviderImpl {
  private environment: Environment;
  private vsCodeApi: { postMessage(msg: unknown): void } | null;

  constructor() {
    this.environment = detectEnvironment();
    this.vsCodeApi = getVsCodeApi();

    // In VSCode, listen for responses from the host
    if (this.environment === 'vscode' && this.vsCodeApi) {
      window.addEventListener('message', (event) => {
        const msg = event.data as TasksResponseMessage;
        if (msg.type === 'tasksResponse' && responseResolvers.has('tasks')) {
          responseResolvers.get('tasks')?.(msg.tasks);
          responseResolvers.delete('tasks');
        }
      });
    }
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
  async updateTaskStatus(id: string, status: ColumnId): Promise<void> {
    if (this.environment === 'vscode' && this.vsCodeApi) {
      this.vsCodeApi.postMessage({
        type: 'taskMoved',
        taskId: id,
        toCol: status,
        index: 0, // Simplified for now
      });
    } else {
      await this.updateTaskStatusViaApi(id, status);
    }
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

  // ── VSCode Communication ────────────────────────────────────────────

  private async getTasksFromVsCode(): Promise<Task[]> {
    if (!this.vsCodeApi) {
      return [];
    }
    const api = this.vsCodeApi;

    return new Promise((resolve) => {
      const timeoutId = setTimeout(() => {
        responseResolvers.delete('tasks');
        resolve([]); // Timeout fallback
      }, 5000);

      responseResolvers.set('tasks', (tasks: Task[]) => {
        clearTimeout(timeoutId);
        resolve(tasks);
      });

      api.postMessage({ type: 'requestTasks' });
    });
  }

  private createTaskViaVsCode(task: Omit<Task, 'id'>): Promise<Task> {
    if (!this.vsCodeApi) {
      return Promise.resolve({
        ...task,
        id: `${task.providerId}:pending-${Date.now()}`,
      });
    }

    // Send saveTask message to extension
    this.vsCodeApi.postMessage({
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

  private async updateTaskStatusViaApi(id: string, status: ColumnId): Promise<void> {
    try {
      const response = await fetch(`${getApiBaseUrl()}/tasks/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      if (!response.ok) {
        console.error('Failed to update task:', response.statusText);
      }
    } catch (error) {
      console.error('Error updating task:', error);
    }
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

/**
 * Pure MCP tool-handler logic for the Agent Board.
 *
 * This module is intentionally free of VS Code dependencies so that it
 * can be unit-tested without the VS Code host and reused inside a
 * standalone stdio MCP server.
 */

import { ColumnId, FIRST_COLUMN } from '../types/ColumnId';
import { KanbanTask } from '../types/KanbanTask';
import {
  CreateTaskArgs,
  DeleteTaskArgs,
  GetTaskArgs,
  ListTasksArgs,
  McpToolDefinition,
  McpToolResult,
  UpdateTaskArgs,
} from './mcpTypes';

// ── Tool catalogue ──────────────────────────────────────────────────

export const MCP_TOOLS: McpToolDefinition[] = [
  {
    name: 'list_tasks',
    description:
      'List tasks on the Agent Board. Optionally filter by Kanban column.',
    inputSchema: {
      type: 'object',
      properties: {
        column: {
          type: 'string',
          description:
            'Filter by column id (e.g. todo, inprogress, review, done). The first column is always todo and the last is always done; intermediate columns are configurable. Omit to list all.',
        },
      },
    },
  },
  {
    name: 'get_task',
    description: 'Get the full details of a single task by its id.',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: {
          type: 'string',
          description: 'Composite task id (e.g. "github:42").',
        },
      },
      required: ['taskId'],
    },
  },
  {
    name: 'update_task',
    description:
      'Update a task on the Agent Board. You can move it to a different column, change its title, body, labels, or assignee.',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: {
          type: 'string',
          description: 'Composite task id (e.g. "github:42").',
        },
        column: {
          type: 'string',
          description:
            'Move the task to this column (e.g. todo, inprogress, review, done). The first column is always todo and the last is always done; intermediate columns are configurable.',
        },
        title: {
          type: 'string',
          description: 'New title for the task.',
        },
        body: {
          type: 'string',
          description: 'New body / description for the task.',
        },
        labels: {
          type: 'array',
          description:
            'Label strings to set on the task (e.g. ["bug","urgent"]).',
          items: { type: 'string' },
        },
        assignee: {
          type: 'string',
          description: 'Assignee username to set on the task.',
        },
      },
      required: ['taskId'],
    },
  },
  {
    name: 'create_task',
    description:
      'Create a new task on the Agent Board.',
    inputSchema: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: 'Title of the new task.',
        },
        body: {
          type: 'string',
          description: 'Body / description of the task (Markdown supported).',
        },
        column: {
          type: 'string',
          description:
            'Column to place the task in (default: todo). The first column is always todo and the last is always done; intermediate columns are configurable.',
        },
        labels: {
          type: 'array',
          description:
            'Label strings (e.g. ["bug","urgent"]).',
          items: { type: 'string' },
        },
        assignee: {
          type: 'string',
          description: 'Assignee username.',
        },
      },
      required: ['title'],
    },
  },
  {
    name: 'delete_task',
    description:
      'Delete a task from the Agent Board by its id.',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: {
          type: 'string',
          description: 'Composite task id (e.g. "github:42").',
        },
      },
      required: ['taskId'],
    },
  },
];

// ── Adapter interface (decouples from VS Code providers) ────────────

/**
 * Minimal contract that the MCP handler needs to read/write tasks.
 *
 * In the VS Code extension this is satisfied by aggregating over
 * `ProviderRegistry`; the standalone MCP server implements it
 * directly against the JSON task file.
 */
export interface McpTaskAdapter {
  getTasks(): Promise<KanbanTask[]>;
  updateTask(task: KanbanTask): Promise<void>;
  createTask(task: KanbanTask): Promise<KanbanTask>;
  deleteTask(taskId: string): Promise<boolean>;
}

// ── Handler ─────────────────────────────────────────────────────────

/**
 * Create a success result wrapping a JSON-serialisable value.
 */
export function successResult(value: unknown): McpToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(value, null, 2) }],
  };
}

/**
 * Create an error result with a human-readable message.
 */
export function errorResult(message: string): McpToolResult {
  return {
    content: [{ type: 'text', text: message }],
    isError: true,
  };
}

/**
 * Handle a `list_tasks` tool call.
 */
export async function handleListTasks(
  adapter: McpTaskAdapter,
  args: ListTasksArgs,
): Promise<McpToolResult> {
  const tasks = await adapter.getTasks();

  const filtered = args.column
    ? tasks.filter(t => t.status === args.column)
    : tasks;

  const summary = filtered.map(t => ({
    id: t.id,
    title: t.title,
    status: t.status,
    labels: t.labels,
    assignee: t.assignee,
    url: t.url,
  }));

  return successResult(summary);
}

/**
 * Handle a `get_task` tool call.
 */
export async function handleGetTask(
  adapter: McpTaskAdapter,
  args: GetTaskArgs,
): Promise<McpToolResult> {
  if (!args.taskId) {
    return errorResult('Missing required parameter: taskId');
  }

  const tasks = await adapter.getTasks();
  const task = tasks.find(t => t.id === args.taskId);

  if (!task) {
    return errorResult(`Task not found: ${args.taskId}`);
  }

  return successResult({
    id: task.id,
    title: task.title,
    body: task.body,
    status: task.status,
    labels: task.labels,
    assignee: task.assignee,
    url: task.url,
    providerId: task.providerId,
    createdAt: task.createdAt?.toISOString?.() ?? task.createdAt,
    copilotSession: task.copilotSession,
  });
}

/**
 * Handle an `update_task` tool call.
 */
export async function handleUpdateTask(
  adapter: McpTaskAdapter,
  args: UpdateTaskArgs,
): Promise<McpToolResult> {
  if (!args.taskId) {
    return errorResult('Missing required parameter: taskId');
  }

  const tasks = await adapter.getTasks();
  const task = tasks.find(t => t.id === args.taskId);

  if (!task) {
    return errorResult(`Task not found: ${args.taskId}`);
  }

  // Column value is not strictly validated here — columns are configurable.
  // Invalid values will be handled by the provider.

  const updated: KanbanTask = {
    ...task,
    ...(args.column ? { status: args.column as ColumnId } : {}),
    ...(args.title !== undefined ? { title: args.title } : {}),
    ...(args.body !== undefined ? { body: args.body } : {}),
    ...(args.labels !== undefined ? { labels: args.labels } : {}),
    ...(args.assignee !== undefined ? { assignee: args.assignee } : {}),
  };

  await adapter.updateTask(updated);

  return successResult({
    id: updated.id,
    title: updated.title,
    status: updated.status,
    labels: updated.labels,
    assignee: updated.assignee,
  });
}

/**
 * Handle a `create_task` tool call.
 */
export async function handleCreateTask(
  adapter: McpTaskAdapter,
  args: CreateTaskArgs,
): Promise<McpToolResult> {
  if (!args.title) {
    return errorResult('Missing required parameter: title');
  }

  // Column value is not strictly validated — columns are configurable.
  const column = args.column ?? FIRST_COLUMN;

  const task: KanbanTask = {
    id: '',
    nativeId: '',
    title: args.title,
    body: args.body ?? '',
    status: column as ColumnId,
    labels: args.labels ?? [],
    assignee: args.assignee,
    providerId: 'json',
    createdAt: new Date(),
    meta: {},
  };

  const created = await adapter.createTask(task);

  return successResult({
    id: created.id,
    title: created.title,
    status: created.status,
    labels: created.labels,
    assignee: created.assignee,
  });
}

/**
 * Handle a `delete_task` tool call.
 */
export async function handleDeleteTask(
  adapter: McpTaskAdapter,
  args: DeleteTaskArgs,
): Promise<McpToolResult> {
  if (!args.taskId) {
    return errorResult('Missing required parameter: taskId');
  }

  const deleted = await adapter.deleteTask(args.taskId);
  if (!deleted) {
    return errorResult(`Task not found: ${args.taskId}`);
  }

  return successResult({ deleted: true, taskId: args.taskId });
}

/**
 * Route a tool call by name.  Returns an error result for unknown tools.
 */
export async function handleToolCall(
  adapter: McpTaskAdapter,
  toolName: string,
  args: Record<string, unknown>,
): Promise<McpToolResult> {
  switch (toolName) {
    case 'list_tasks':
      return handleListTasks(adapter, args as unknown as ListTasksArgs);
    case 'get_task':
      return handleGetTask(adapter, args as unknown as GetTaskArgs);
    case 'update_task':
      return handleUpdateTask(adapter, args as unknown as UpdateTaskArgs);
    case 'create_task':
      return handleCreateTask(adapter, args as unknown as CreateTaskArgs);
    case 'delete_task':
      return handleDeleteTask(adapter, args as unknown as DeleteTaskArgs);
    default:
      return errorResult(`Unknown tool: ${toolName}`);
  }
}

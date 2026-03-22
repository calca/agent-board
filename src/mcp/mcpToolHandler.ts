/**
 * Pure MCP tool-handler logic for the Agent Board.
 *
 * This module is intentionally free of VS Code dependencies so that it
 * can be unit-tested without the VS Code host and reused inside a
 * standalone stdio MCP server.
 */

import { ColumnId, COLUMN_IDS } from '../types/ColumnId';
import { KanbanTask } from '../types/KanbanTask';
import {
  McpToolDefinition,
  McpToolResult,
  ListTasksArgs,
  GetTaskArgs,
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
            'Filter by column id (todo, inprogress, review, done). Omit to list all.',
          enum: [...COLUMN_IDS],
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
            'Move the task to this column (todo, inprogress, review, done).',
          enum: [...COLUMN_IDS],
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
          type: 'string',
          description:
            'Comma-separated list of labels to set on the task.',
        },
        assignee: {
          type: 'string',
          description: 'Assignee username to set on the task.',
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

  // Validate column if provided
  if (args.column && !(COLUMN_IDS as readonly string[]).includes(args.column)) {
    return errorResult(
      `Invalid column "${args.column}". Must be one of: ${COLUMN_IDS.join(', ')}`,
    );
  }

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
    default:
      return errorResult(`Unknown tool: ${toolName}`);
  }
}

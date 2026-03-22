#!/usr/bin/env node
/**
 * Standalone stdio-based MCP server for Agent Board.
 *
 * Agents connect to this process over stdin/stdout using JSON-RPC 2.0
 * as specified by the Model Context Protocol.
 *
 * Usage:
 *   node out/mcp/mcpServer.js [--tasks <path>]
 *
 * Defaults to `.agent-board/tasks` in the current working directory.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import { ColumnId, COLUMN_IDS } from '../types/ColumnId';
import { KanbanTask } from '../types/KanbanTask';
import { JsonRpcRequest, JsonRpcResponse } from './mcpTypes';
import {
  MCP_TOOLS,
  McpTaskAdapter,
  handleToolCall,
} from './mcpToolHandler';

// ── CLI argument parsing ────────────────────────────────────────────

function resolveTasksPath(): string {
  const args = process.argv.slice(2);
  const idx = args.indexOf('--tasks');
  const raw = idx !== -1 && args[idx + 1] ? args[idx + 1] : '.agent-board/tasks';
  return path.isAbsolute(raw) ? raw : path.resolve(process.cwd(), raw);
}

// ── JSON file adapter ───────────────────────────────────────────────

interface JsonTaskEntry {
  id: string;
  title: string;
  body?: string;
  status?: string;
  labels?: string[];
  assignee?: string;
  url?: string;
  createdAt?: string;
  [key: string]: unknown;
}

function normalizeStatus(raw?: string): ColumnId {
  if (raw && (COLUMN_IDS as readonly string[]).includes(raw)) {
    return raw as ColumnId;
  }
  return 'todo';
}

function readTasks(filePath: string): KanbanTask[] {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw);
    const entries: JsonTaskEntry[] = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed.tasks)
        ? parsed.tasks
        : [];
    return entries.map(e => ({
      id: `json:${e.id}`,
      title: e.title ?? 'Untitled',
      body: e.body ?? '',
      status: normalizeStatus(e.status),
      labels: e.labels ?? [],
      assignee: e.assignee,
      url: e.url,
      providerId: 'json',
      createdAt: e.createdAt ? new Date(e.createdAt) : undefined,
      meta: e as unknown as Record<string, unknown>,
    }));
  } catch {
    return [];
  }
}

function writeTasks(filePath: string, tasks: KanbanTask[]): void {
  const entries = tasks.map(t => ({
    id: t.id.replace(/^json:/, ''),
    title: t.title,
    body: t.body,
    status: t.status,
    labels: t.labels,
    assignee: t.assignee,
    url: t.url,
    createdAt: t.createdAt instanceof Date ? t.createdAt.toISOString() : t.createdAt,
  }));
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(filePath, JSON.stringify(entries, null, 2), 'utf-8');
}

function createFileAdapter(filePath: string): McpTaskAdapter {
  return {
    async getTasks() {
      return readTasks(filePath);
    },
    async updateTask(task: KanbanTask) {
      const tasks = readTasks(filePath);
      const idx = tasks.findIndex(t => t.id === task.id);
      if (idx !== -1) {
        tasks[idx] = task;
      }
      writeTasks(filePath, tasks);
    },
    async createTask(task: KanbanTask) {
      const tasks = readTasks(filePath);
      const maxId = tasks.reduce((max, t) => {
        const num = parseInt(t.id.replace(/^json:/, ''), 10);
        return isNaN(num) ? max : Math.max(max, num);
      }, 0);
      const newId = `json:${maxId + 1}`;
      const created: KanbanTask = { ...task, id: newId };
      tasks.push(created);
      writeTasks(filePath, tasks);
      return created;
    },
  };
}

// ── JSON-RPC dispatch ───────────────────────────────────────────────

const PROTOCOL_VERSION = '2024-11-05';

const SERVER_INFO = {
  name: 'agent-board-mcp',
  version: '0.1.0',
};

async function dispatch(
  adapter: McpTaskAdapter,
  req: JsonRpcRequest,
): Promise<JsonRpcResponse> {
  const id = req.id;

  switch (req.method) {
    case 'initialize':
      return {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: PROTOCOL_VERSION,
          serverInfo: SERVER_INFO,
          capabilities: { tools: {} },
        },
      };

    case 'notifications/initialized':
      // Acknowledgement — no response needed but we send one if an id is present
      return { jsonrpc: '2.0', id, result: {} };

    case 'tools/list':
      return {
        jsonrpc: '2.0',
        id,
        result: { tools: MCP_TOOLS },
      };

    case 'tools/call': {
      const params = req.params ?? {};
      const toolName = params.name as string;
      const toolArgs = (params.arguments ?? {}) as Record<string, unknown>;
      const toolResult = await handleToolCall(adapter, toolName, toolArgs);
      return { jsonrpc: '2.0', id, result: toolResult };
    }

    default:
      return {
        jsonrpc: '2.0',
        id,
        error: { code: -32601, message: `Method not found: ${req.method}` },
      };
  }
}

// ── Stdio transport ─────────────────────────────────────────────────

function main(): void {
  const tasksPath = resolveTasksPath();
  const adapter = createFileAdapter(tasksPath);

  const rl = readline.createInterface({ input: process.stdin });

  rl.on('line', async (line: string) => {
    if (!line.trim()) {
      return;
    }
    try {
      const req: JsonRpcRequest = JSON.parse(line);
      const res = await dispatch(adapter, req);
      process.stdout.write(JSON.stringify(res) + '\n');
    } catch {
      const errRes: JsonRpcResponse = {
        jsonrpc: '2.0',
        id: null,
        error: { code: -32700, message: 'Parse error' },
      };
      process.stdout.write(JSON.stringify(errRes) + '\n');
    }
  });

  rl.on('close', () => {
    process.exit(0);
  });
}

// Allow importing for tests while still running as CLI
export {
  resolveTasksPath,
  readTasks,
  writeTasks,
  createFileAdapter,
  dispatch,
  normalizeStatus,
  PROTOCOL_VERSION,
  SERVER_INFO,
};

// Only run main when executed directly (not imported)
if (require.main === module) {
  main();
}

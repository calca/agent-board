/**
 * MCP (Model Context Protocol) type definitions.
 *
 * These types model the subset of the MCP protocol used by the
 * Agent Board MCP server.  They are intentionally kept free of
 * VS Code dependencies so they can be used in standalone processes.
 */

// ── JSON-RPC transport ──────────────────────────────────────────────

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number | string;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number | string | null;
  result?: unknown;
  error?: JsonRpcError;
}

export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

// ── MCP tool schema ─────────────────────────────────────────────────

export interface McpToolProperty {
  type: string;
  description: string;
  enum?: string[];
}

export interface McpToolInputSchema {
  type: 'object';
  properties: Record<string, McpToolProperty>;
  required?: string[];
}

export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: McpToolInputSchema;
}

// ── MCP content blocks ──────────────────────────────────────────────

export interface McpTextContent {
  type: 'text';
  text: string;
}

export type McpContent = McpTextContent;

// ── MCP tool call result ────────────────────────────────────────────

export interface McpToolResult {
  content: McpContent[];
  isError?: boolean;
}

// ── Tool-call argument shapes ───────────────────────────────────────

export interface ListTasksArgs {
  column?: string;
}

export interface GetTaskArgs {
  taskId: string;
}

export interface UpdateTaskArgs {
  taskId: string;
  column?: string;
  title?: string;
  body?: string;
  labels?: string[];
  assignee?: string;
}

export interface CreateTaskArgs {
  title: string;
  body?: string;
  column?: string;
  labels?: string[];
  assignee?: string;
}

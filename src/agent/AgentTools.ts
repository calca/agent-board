import { exec } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { Logger } from '../utils/logger';

/** Maximum command execution time in ms. */
const COMMAND_TIMEOUT_MS = 30_000;

/** Result returned by each tool execution. */
export interface ToolResult {
  content: string;
  isError?: boolean;
}

/**
 * Agent tools exposed to `vscode.lm` tool-calling API.
 *
 * All file-system tools enforce **path traversal prevention** by
 * resolving paths relative to `workspaceRoot` and rejecting any
 * that escape it.
 *
 * Available tools:
 * - `read_file` — read file contents
 * - `write_file` — write content to a file
 * - `run_command` — execute a shell command
 * - `get_diff` — `git diff` for the workspace
 * - `list_files` — list directory contents
 */
export class AgentTools {
  private readonly logger = Logger.getInstance();
  private readonly yolo: boolean;

  constructor(private readonly workspaceRoot: string, options?: { yolo?: boolean }) {
    this.yolo = options?.yolo ?? false;
  }

  /** Return the tool definitions for the vscode.lm API. */
  getToolDefinitions(): AgentToolDefinition[] {
    return [
      {
        name: 'read_file',
        description: 'Read the content of a file relative to the workspace root.',
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Relative file path' },
          },
          required: ['path'],
        },
      },
      {
        name: 'write_file',
        description: 'Write content to a file relative to the workspace root.',
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Relative file path' },
            content: { type: 'string', description: 'File content to write' },
          },
          required: ['path', 'content'],
        },
      },
      {
        name: 'run_command',
        description: 'Run a shell command in the workspace root. Timeout: 30s.',
        inputSchema: {
          type: 'object',
          properties: {
            command: { type: 'string', description: 'Shell command to execute' },
          },
          required: ['command'],
        },
      },
      {
        name: 'get_diff',
        description: 'Return git diff for the workspace.',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'list_files',
        description: 'List files and directories at a given path relative to workspace root.',
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Relative directory path (default: ".")' },
          },
        },
      },
    ];
  }

  /** Execute a tool call by name and return the result. */
  async execute(toolName: string, args: Record<string, unknown>): Promise<ToolResult> {
    try {
      switch (toolName) {
        case 'read_file':
          return this.readFile(String(args.path ?? ''));
        case 'write_file':
          return this.writeFile(String(args.path ?? ''), String(args.content ?? ''));
        case 'run_command':
          return this.runCommand(String(args.command ?? ''));
        case 'get_diff':
          return this.getDiff();
        case 'list_files':
          return this.listFiles(String(args.path ?? '.'));
        default:
          return { content: `Unknown tool: ${toolName}`, isError: true };
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`AgentTools.${toolName} error:`, message);
      return { content: message, isError: true };
    }
  }

  // ── Tool implementations ────────────────────────────────────────

  private readFile(relativePath: string): ToolResult {
    const absPath = this.resolveSafe(relativePath);
    if (!absPath) {
      return { content: 'Path traversal denied', isError: true };
    }
    if (!fs.existsSync(absPath)) {
      return { content: `File not found: ${relativePath}`, isError: true };
    }
    const content = fs.readFileSync(absPath, 'utf-8');
    return { content };
  }

  private writeFile(relativePath: string, content: string): ToolResult {
    const absPath = this.resolveSafe(relativePath);
    if (!absPath) {
      return { content: 'Path traversal denied', isError: true };
    }
    const dir = path.dirname(absPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(absPath, content, 'utf-8');
    return { content: `Written ${relativePath}` };
  }

  private async runCommand(command: string): Promise<ToolResult> {
    if (!this.yolo) {
      // Security: require explicit user confirmation before executing shell commands
      const confirm = await vscode.window.showWarningMessage(
        `Agent Board: l'agente vuole eseguire:\n\n\`${command}\``,
        { modal: true },
        'Esegui',
        'Annulla',
      );
      if (confirm !== 'Esegui') {
        return { content: 'Command cancelled by user.', isError: true };
      }
    } else {
      this.logger.info('AgentTools: YOLO — auto-approving: %s', command);
    }

    return new Promise(resolve => {
      exec(
        command,
        { cwd: this.workspaceRoot, timeout: COMMAND_TIMEOUT_MS, maxBuffer: 1024 * 1024 },
        (err, stdout, stderr) => {
          if (err) {
            resolve({ content: `${stderr || err.message}`.trim(), isError: true });
            return;
          }
          resolve({ content: stdout.trim() || stderr.trim() || '(no output)' });
        },
      );
    });
  }

  private getDiff(): Promise<ToolResult> {
    return new Promise(resolve => {
      exec(
        'git diff',
        { cwd: this.workspaceRoot, timeout: COMMAND_TIMEOUT_MS },
        (err, stdout) => {
          if (err) {
            resolve({ content: `git diff failed: ${err.message}`, isError: true });
            return;
          }
          resolve({ content: stdout.trim() || '(no changes)' });
        },
      );
    });
  }

  private listFiles(relativePath: string): ToolResult {
    const absPath = this.resolveSafe(relativePath);
    if (!absPath) {
      return { content: 'Path traversal denied', isError: true };
    }
    if (!fs.existsSync(absPath)) {
      return { content: `Directory not found: ${relativePath}`, isError: true };
    }
    const entries = fs.readdirSync(absPath, { withFileTypes: true });
    const lines = entries.map(e => (e.isDirectory() ? `${e.name}/` : e.name));
    return { content: lines.join('\n') };
  }

  // ── Security ────────────────────────────────────────────────────

  /**
   * Resolve a relative path against the workspace root.
   * Returns `undefined` if the resolved path escapes the root.
   * Uses realpath to prevent symlink-based bypass.
   */
  private resolveSafe(relativePath: string): string | undefined {
    const resolved = path.resolve(this.workspaceRoot, relativePath);
    const normalised = path.normalize(resolved);
    if (!normalised.startsWith(this.workspaceRoot)) {
      this.logger.warn('AgentTools: path traversal attempt blocked: %s', relativePath);
      return undefined;
    }
    // Resolve symlinks so that a symlink inside the workspace pointing outside is caught
    try {
      const real = fs.realpathSync(normalised);
      const realRoot = fs.realpathSync(this.workspaceRoot);
      if (!real.startsWith(realRoot)) {
        this.logger.warn('AgentTools: symlink escape blocked: %s → %s', relativePath, real);
        return undefined;
      }
    } catch {
      // File doesn't exist yet (write_file case) — fall through to the normalised check
    }
    return normalised;
  }
}

/** Minimal schema for a tool definition used with vscode.lm. */
export interface AgentToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/**
 * McpRegistration — registers/deregisters the Agent Board MCP server
 * with VS Code (API) and Copilot CLI (.vscode/mcp.json).
 *
 * Two discovery channels:
 *  1. `vscode.lm.registerMcpServerDefinitionProvider` — VS Code native
 *  2. `.vscode/mcp.json` — Copilot CLI and other MCP clients
 */
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { Logger } from '../utils/logger';

const logger = Logger.getInstance();
const MCP_SERVER_KEY = 'agent-board';

interface McpJson {
  servers?: Record<string, unknown>;
  [key: string]: unknown;
}

/**
 * Strip single-line (//) and block comments from a JSONC string
 * so it can be parsed with JSON.parse.  Respects quoted strings.
 */
function stripJsoncComments(text: string): string {
  let result = '';
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    // String literal — copy verbatim
    if (ch === '"') {
      let j = i + 1;
      while (j < text.length) {
        if (text[j] === '\\') { j += 2; continue; }
        if (text[j] === '"') { j++; break; }
        j++;
      }
      result += text.slice(i, j);
      i = j;
      continue;
    }
    // Line comment
    if (ch === '/' && text[i + 1] === '/') {
      const nl = text.indexOf('\n', i);
      i = nl === -1 ? text.length : nl;
      continue;
    }
    // Block comment
    if (ch === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      i = end === -1 ? text.length : end + 2;
      continue;
    }
    result += ch;
    i++;
  }
  // Strip trailing commas before } or ]
  return result.replace(/,\s*([}\]])/g, '$1');
}

export class McpRegistration implements vscode.Disposable {
  private enabled = false;
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  private readonly disposables: vscode.Disposable[] = [];
  private readonly workspaceRoot: string | undefined;

  constructor(private readonly extensionPath: string) {
    this.disposables.push(this._onDidChange);
    this.workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  }

  /** Register the definition provider with VS Code. Call once at activation. */
  register(): vscode.Disposable {
    const registration = vscode.lm.registerMcpServerDefinitionProvider(
      'agent-board.mcp-server',
      {
        onDidChangeMcpServerDefinitions: this._onDidChange.event,
        provideMcpServerDefinitions: () => {
          if (!this.enabled) {
            return [];
          }
          const serverJs = path.join(this.extensionPath, 'dist', 'mcpServer.js');
          return [new vscode.McpStdioServerDefinition(
            'Agent Board',
            process.execPath,
            [serverJs],
          )];
        },
      },
    );
    this.disposables.push(registration);
    return registration;
  }

  /** Update the enabled state: notify VS Code API + write/remove .vscode/mcp.json. */
  setEnabled(value: boolean): void {
    if (this.enabled === value) { return; }
    this.enabled = value;
    this._onDidChange.fire();
    this.syncMcpJson();
    logger.info(`MCP server registration ${value ? 'enabled' : 'disabled'}`);
  }

  // ── .vscode/mcp.json management ────────────────────────────────────

  private syncMcpJson(): void {
    if (!this.workspaceRoot) { return; }
    const mcpJsonPath = path.join(this.workspaceRoot, '.vscode', 'mcp.json');

    try {
      if (this.enabled) {
        this.writeMcpJson(mcpJsonPath);
      } else {
        this.removeMcpEntry(mcpJsonPath);
      }
    } catch (err) {
      logger.error('Failed to update .vscode/mcp.json: %s', String(err));
    }
  }

  private writeMcpJson(mcpJsonPath: string): void {
    const serverJs = path.join(this.extensionPath, 'dist', 'mcpServer.js');
    const existing = this.readMcpJson(mcpJsonPath);

    existing.servers = existing.servers ?? {};
    existing.servers[MCP_SERVER_KEY] = {
      type: 'stdio',
      command: 'node',
      args: [serverJs],
    };

    const dir = path.dirname(mcpJsonPath);
    if (!fs.existsSync(dir)) { fs.mkdirSync(dir, { recursive: true }); }
    fs.writeFileSync(mcpJsonPath, JSON.stringify(existing, null, 2) + '\n', 'utf-8');
  }

  private removeMcpEntry(mcpJsonPath: string): void {
    if (!fs.existsSync(mcpJsonPath)) { return; }
    const existing = this.readMcpJson(mcpJsonPath);

    if (existing.servers?.[MCP_SERVER_KEY]) {
      delete existing.servers[MCP_SERVER_KEY];

      // If no servers left, remove the file entirely
      if (Object.keys(existing.servers).length === 0 && Object.keys(existing).length === 1) {
        fs.unlinkSync(mcpJsonPath);
      } else {
        fs.writeFileSync(mcpJsonPath, JSON.stringify(existing, null, 2) + '\n', 'utf-8');
      }
    }
  }

  private readMcpJson(mcpJsonPath: string): McpJson {
    if (!fs.existsSync(mcpJsonPath)) { return {}; }
    try {
      const raw = fs.readFileSync(mcpJsonPath, 'utf-8');
      return JSON.parse(stripJsoncComments(raw)) as McpJson;
    } catch {
      return {};
    }
  }

  dispose(): void {
    for (const d of this.disposables) { d.dispose(); }
    this.disposables.length = 0;
  }
}

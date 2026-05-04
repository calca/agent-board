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
import * as jsonc from 'jsonc-parser';
import * as vscode from 'vscode';
import { Logger } from '../utils/logger';

const logger = Logger.getInstance();
const MCP_SERVER_KEY = 'agent-board';

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
    const text = this.readMcpJsonText(mcpJsonPath);

    // Use jsonc.modify to add the server entry, preserving comments & formatting
    const edits = jsonc.modify(text, ['servers', MCP_SERVER_KEY], {
      type: 'stdio',
      command: 'node',
      args: [serverJs],
    }, { formattingOptions: { tabSize: 2, insertSpaces: true } });
    const updated = jsonc.applyEdits(text, edits);

    const dir = path.dirname(mcpJsonPath);
    if (!fs.existsSync(dir)) { fs.mkdirSync(dir, { recursive: true }); }
    fs.writeFileSync(mcpJsonPath, updated, 'utf-8');
  }

  private removeMcpEntry(mcpJsonPath: string): void {
    if (!fs.existsSync(mcpJsonPath)) { return; }
    const text = this.readMcpJsonText(mcpJsonPath);
    const parsed = jsonc.parse(text) as Record<string, unknown> | undefined;

    if (parsed?.servers && typeof parsed.servers === 'object' &&
        MCP_SERVER_KEY in (parsed.servers as Record<string, unknown>)) {
      const servers = parsed.servers as Record<string, unknown>;

      // If this is the only server and no other top-level keys, remove the file
      if (Object.keys(servers).length === 1 && Object.keys(parsed).length === 1) {
        fs.unlinkSync(mcpJsonPath);
      } else {
        const edits = jsonc.modify(text, ['servers', MCP_SERVER_KEY], undefined,
          { formattingOptions: { tabSize: 2, insertSpaces: true } });
        fs.writeFileSync(mcpJsonPath, jsonc.applyEdits(text, edits), 'utf-8');
      }
    }
  }

  private readMcpJsonText(mcpJsonPath: string): string {
    if (!fs.existsSync(mcpJsonPath)) { return '{}'; }
    try {
      return fs.readFileSync(mcpJsonPath, 'utf-8');
    } catch {
      return '{}';
    }
  }

  dispose(): void {
    for (const d of this.disposables) { d.dispose(); }
    this.disposables.length = 0;
  }
}

import * as vscode from 'vscode';
import { ProjectConfig } from '../config/ProjectConfig';
import { DEFAULT_COLUMN_COLORS, DEFAULT_COLUMN_LABELS, buildColumnOrder } from '../types/ColumnId';
import { KanbanTask } from '../types/KanbanTask';
import { AgentOption, Column, FileChangeInfo, GenAiProviderOption, HostToWebView, SquadStatus, UIBlockMsg, WebViewToHost } from '../types/Messages';
import { Logger } from '../utils/logger';

/**
 * Manages the Kanban board WebView panel.
 *
 * - `retainContextWhenHidden: true` so the panel survives being backgrounded.
 * - Implements `WebviewPanelSerializer` for restore after VS Code reload.
 * - Strict CSP with nonces for inline scripts.
 */
export class KanbanPanel {
  public static readonly viewType = 'agentBoard.kanbanView';

  private static instance: KanbanPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private disposables: vscode.Disposable[] = [];
  private readonly isDev: boolean;
  private reloadTimer: ReturnType<typeof setTimeout> | undefined;

  private onMessageCallbacks: ((msg: WebViewToHost) => void)[] = [];

  private constructor(
    panel: vscode.WebviewPanel,
    private readonly extensionUri: vscode.Uri,
    extensionMode: vscode.ExtensionMode,
  ) {
    this.panel = panel;
    this.isDev = extensionMode === vscode.ExtensionMode.Development;
    this.panel.webview.html = this.getHtml(this.panel.webview);

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

    this.panel.webview.onDidReceiveMessage(
      (msg: WebViewToHost) => {
        for (const cb of this.onMessageCallbacks) { cb(msg); }
      },
      null,
      this.disposables,
    );

    if (this.isDev) {
      this.setupDevWatcher();
    }
  }

  /** Create or reveal the singleton panel. */
  static createOrShow(extensionUri: vscode.Uri, extensionMode: vscode.ExtensionMode): KanbanPanel {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    if (KanbanPanel.instance) {
      KanbanPanel.instance.panel.reveal(column);
      return KanbanPanel.instance;
    }

    const panel = vscode.window.createWebviewPanel(
      KanbanPanel.viewType,
      'Agent Board — Kanban',
      column || vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'dist')],
      },
    );

    KanbanPanel.instance = new KanbanPanel(panel, extensionUri, extensionMode);
    Logger.getInstance().info('KanbanPanel: created');
    return KanbanPanel.instance;
  }

  /** Return the active singleton instance, or undefined if no panel is open. */
  static getInstance(): KanbanPanel | undefined {
    return KanbanPanel.instance;
  }

  /** Serializer for restoring the panel after reload. */
  static getSerializer(extensionUri: vscode.Uri, extensionMode: vscode.ExtensionMode): vscode.WebviewPanelSerializer {
    return {
      async deserializeWebviewPanel(panel: vscode.WebviewPanel): Promise<void> {
        KanbanPanel.instance = new KanbanPanel(panel, extensionUri, extensionMode);
        // Re-wire all handlers by executing the openKanban command.
        // The command checks for an existing instance and just reveals + wires it.
        await vscode.commands.executeCommand('agentBoard.openKanban');
      },
    };
  }

  /** Remove all message callbacks (use before re-wiring handlers). */
  clearMessageHandlers(): void {
    this.onMessageCallbacks = [];
  }

  /** Register a callback for messages from the WebView. */
  onMessage(callback: (msg: WebViewToHost) => void): void {
    this.onMessageCallbacks.push(callback);
  }

  /** Register a callback invoked when the panel is disposed. */
  onDispose(callback: () => void): void {
    this.panel.onDidDispose(callback, null, this.disposables);
  }

  private disposed = false;

  /** Send a typed message to the WebView. */
  postMessage(msg: HostToWebView): void {
    if (this.disposed) { return; }
    this.panel.webview.postMessage(msg);
  }

  /** Push a full task + column update to the WebView. */
  updateTasks(tasks: KanbanTask[], editableProviderIds: string[] = [], genAiProviders: GenAiProviderOption[] = []): void {
    const columnOrder = buildColumnOrder(ProjectConfig.getProjectConfig()?.kanban?.intermediateColumns);
    const columns: Column[] = columnOrder.map(id => ({
      id,
      label: DEFAULT_COLUMN_LABELS[id] ?? id,
      color: DEFAULT_COLUMN_COLORS[id],
    }));
    this.postMessage({ type: 'tasksUpdate', tasks, columns, editableProviderIds, genAiProviders });
  }

  /** Push the current squad status to the WebView. */
  updateSquadStatus(status: SquadStatus): void {
    this.postMessage({ type: 'squadStatus', status });
  }

  /** Push the list of discovered agents to the WebView. */
  updateAgents(agents: AgentOption[]): void {
    this.postMessage({ type: 'agentsAvailable', agents });
  }

  /** Push the current MCP server status to the WebView. */
  updateMcpStatus(enabled: boolean): void {
    this.postMessage({ type: 'mcpStatus', enabled });
  }

  /** Push a stream-output chunk for a session to the WebView. */
  appendStreamOutput(sessionId: string, text: string, ts: string, role?: 'user' | 'assistant' | 'tool'): void {
    this.postMessage({ type: 'streamOutput', sessionId, text, ts, role });
  }

  /** Notify the WebView that a tool call is in progress for a session. */
  notifyToolCall(sessionId: string, status: string): void {
    this.postMessage({ type: 'toolCall', sessionId, status });
  }

  /** Push a structured chat block for a session to the WebView. */
  appendChatBlock(sessionId: string, block: UIBlockMsg): void {
    this.postMessage({ type: 'chatBlock', sessionId, block });
  }

  /** Signal the start of a new assistant turn. */
  notifyChatStart(sessionId: string): void {
    this.postMessage({ type: 'chatStart', sessionId });
  }

  /** Signal the end of an assistant turn. */
  notifyChatEnd(sessionId: string): void {
    this.postMessage({ type: 'chatEnd', sessionId });
  }

  /** Send the initial prompt to the chat UI (displayed as a board message). */
  sendChatPrompt(sessionId: string, prompt: string): void {
    this.postMessage({ type: 'chatPrompt', sessionId, prompt });
  }

  /** Send a board-level event (state change, action) to the chat UI. */
  sendChatBoardEvent(sessionId: string, text: string): void {
    this.postMessage({ type: 'chatBoardEvent', sessionId, text });
  }

  /** Push the latest file-change list for a session to the WebView. */
  updateFileChanges(sessionId: string, files: FileChangeInfo[]): void {
    this.postMessage({ type: 'fileChanges', sessionId, files });
  }

  /** Reload the webview HTML (triggers full React remount + ready handshake). */
  reloadHtml(): void {
    if (this.disposed) { return; }
    this.panel.webview.html = this.getHtml(this.panel.webview);
  }

  dispose(): void {
    this.disposed = true;
    if (this.reloadTimer) { clearTimeout(this.reloadTimer); }
    KanbanPanel.instance = undefined;
    this.panel.dispose();
    for (const d of this.disposables) {
      d.dispose();
    }
    this.disposables = [];
  }

  // ── private ─────────────────────────────────────────────────────────

  /** Watch dist/webview.* for changes and auto-reload in dev mode. */
  private setupDevWatcher(): void {
    const distPattern = new vscode.RelativePattern(
      vscode.Uri.joinPath(this.extensionUri, 'dist'),
      'webview.*',
    );
    const watcher = vscode.workspace.createFileSystemWatcher(distPattern);
    const scheduleReload = () => {
      if (this.reloadTimer) { clearTimeout(this.reloadTimer); }
      this.reloadTimer = setTimeout(() => this.reloadHtml(), 300);
    };
    watcher.onDidChange(scheduleReload, null, this.disposables);
    watcher.onDidCreate(scheduleReload, null, this.disposables);
    this.disposables.push(watcher);
  }

  private getHtml(webview: vscode.Webview): string {
    const nonce = this.getNonce();
    const cacheBust = Date.now();
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview.js'),
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview.css'),
    );

    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy"
        content="default-src 'none';
                 style-src ${webview.cspSource} 'unsafe-inline';
                 script-src 'nonce-${nonce}';
                 connect-src http://localhost:* http://127.0.0.1:* https://*.loca.lt;
                 font-src ${webview.cspSource};
                 img-src ${webview.cspSource} https:;">
  <link rel="stylesheet" href="${styleUri}?v=${cacheBust}">
  <title>Agent Board - Kanban</title>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" src="${scriptUri}?v=${cacheBust}"></script>
</body>
</html>`;
  }

  private getNonce(): string {
    let text = '';
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
      text += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return text;
  }
}

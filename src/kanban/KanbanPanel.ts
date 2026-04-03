import * as vscode from 'vscode';
import { COLUMN_IDS, COLUMN_LABELS } from '../types/ColumnId';
import { KanbanTask } from '../types/KanbanTask';
import { AgentOption, Column, FileChangeInfo, GenAiProviderOption, HostToWebView, SquadStatus, WebViewToHost } from '../types/Messages';

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

  private onMessageCallback: ((msg: WebViewToHost) => void) | undefined;

  private constructor(
    panel: vscode.WebviewPanel,
    private readonly extensionUri: vscode.Uri,
  ) {
    this.panel = panel;
    this.panel.webview.html = this.getHtml(this.panel.webview);

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

    this.panel.webview.onDidReceiveMessage(
      (msg: WebViewToHost) => {
        this.onMessageCallback?.(msg);
      },
      null,
      this.disposables,
    );
  }

  /** Create or reveal the singleton panel. */
  static createOrShow(extensionUri: vscode.Uri): KanbanPanel {
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

    KanbanPanel.instance = new KanbanPanel(panel, extensionUri);
    return KanbanPanel.instance;
  }

  /** Return the active singleton instance, or undefined if no panel is open. */
  static getInstance(): KanbanPanel | undefined {
    return KanbanPanel.instance;
  }

  /** Serializer for restoring the panel after reload. */
  static getSerializer(extensionUri: vscode.Uri): vscode.WebviewPanelSerializer {
    return {
      deserializeWebviewPanel(panel: vscode.WebviewPanel): Thenable<void> {
        KanbanPanel.instance = new KanbanPanel(panel, extensionUri);
        return Promise.resolve();
      },
    };
  }

  /** Register a callback for messages from the WebView. */
  onMessage(callback: (msg: WebViewToHost) => void): void {
    this.onMessageCallback = callback;
  }

  /** Register a callback invoked when the panel is disposed. */
  onDispose(callback: () => void): void {
    this.panel.onDidDispose(callback, null, this.disposables);
  }

  /** Send a typed message to the WebView. */
  postMessage(msg: HostToWebView): void {
    this.panel.webview.postMessage(msg);
  }

  /** Push a full task + column update to the WebView. */
  updateTasks(tasks: KanbanTask[], editableProviderIds: string[] = [], genAiProviders: GenAiProviderOption[] = []): void {
    const columns: Column[] = COLUMN_IDS.map(id => ({
      id,
      label: COLUMN_LABELS[id],
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
  appendStreamOutput(sessionId: string, text: string): void {
    this.postMessage({ type: 'streamOutput', sessionId, text });
  }

  /** Push the latest file-change list for a session to the WebView. */
  updateFileChanges(sessionId: string, files: FileChangeInfo[]): void {
    this.postMessage({ type: 'fileChanges', sessionId, files });
  }

  dispose(): void {
    KanbanPanel.instance = undefined;
    this.panel.dispose();
    for (const d of this.disposables) {
      d.dispose();
    }
    this.disposables = [];
  }

  // ── private ─────────────────────────────────────────────────────────

  private getHtml(webview: vscode.Webview): string {
    const nonce = this.getNonce();
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
                 font-src ${webview.cspSource};
                 img-src ${webview.cspSource} https:;">
  <link rel="stylesheet" href="${styleUri}">
  <title>Agent Board - Kanban</title>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
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

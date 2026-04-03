import * as vscode from 'vscode';
import { HostToWebView, WebViewToHost } from '../types/Messages';
import { Logger } from '../utils/logger';

/**
 * Typed wrapper around `postMessage` / `onDidReceiveMessage` for
 * communication between the extension host and a Kanban WebView.
 *
 * Messages with an unknown `type` are logged and ignored.
 */
export class MessageBridge {
  private readonly logger = Logger.getInstance();
  private readonly disposables: vscode.Disposable[] = [];

  constructor(private readonly webview: vscode.Webview) {}

  /** Send a typed message from host → WebView. */
  post(msg: HostToWebView): void {
    this.webview.postMessage(msg);
  }

  /** Listen for typed messages from WebView → host. */
  onMessage(handler: (msg: WebViewToHost) => void): void {
    const sub = this.webview.onDidReceiveMessage((raw: unknown) => {
      if (!this.isWebViewMessage(raw)) {
        this.logger.warn('MessageBridge: received unknown message type', JSON.stringify(raw));
        return;
      }
      handler(raw);
    });
    this.disposables.push(sub);
  }

  dispose(): void {
    for (const d of this.disposables) {
      d.dispose();
    }
  }

  // ── private ─────────────────────────────────────────────────────────

  private isWebViewMessage(msg: unknown): msg is WebViewToHost {
    if (typeof msg !== 'object' || msg === null) {
      return false;
    }
    const typed = msg as Record<string, unknown>;
    const validTypes = ['taskMoved', 'openCopilot', 'refreshRequest', 'ready', 'startSquad', 'toggleAutoSquad', 'launchProvider'];
    return typeof typed.type === 'string' && validTypes.includes(typed.type);
  }
}

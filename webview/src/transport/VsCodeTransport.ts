/**
 * Transport implementation for the VS Code WebView environment.
 *
 * Uses `acquireVsCodeApi().postMessage()` for outgoing messages and
 * `window.addEventListener('message', ...)` for incoming messages.
 *
 * Responses to `request()` are correlated via `requestId`.
 * Everything else is dispatched to push handlers.
 */

import { getVsCodeApi } from '../hooks/useVsCodeApi';
import type { ITransport, PushHandler } from './ITransport';

export class VsCodeTransport implements ITransport {
  private readonly pendingRequests = new Map<string, { resolve: (v: any) => void; matchType: string }>();
  private readonly pushHandlers = new Set<PushHandler>();

  constructor() {
    window.addEventListener('message', (event: MessageEvent) => {
      const msg = event.data;
      if (!msg || typeof msg !== 'object') { return; }

      // Check if this message resolves a pending request
      if (msg.requestId && this.pendingRequests.has(msg.requestId)) {
        const entry = this.pendingRequests.get(msg.requestId)!;
        if (msg.type === entry.matchType) {
          this.pendingRequests.delete(msg.requestId);
          entry.resolve(msg);
          return;
        }
      }

      // Otherwise dispatch to push handlers
      for (const handler of this.pushHandlers) {
        handler(msg);
      }
    });
  }

  send(msg: any): void {
    getVsCodeApi()?.postMessage(msg);
  }

  request<T = any>(
    msg: any & { requestId: string },
    matchType: string,
    timeoutMs = 5000,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(msg.requestId);
        reject(new Error(`Transport request timed out (${matchType})`));
      }, timeoutMs);

      this.pendingRequests.set(msg.requestId, {
        resolve: (value: T) => {
          clearTimeout(timer);
          resolve(value);
        },
        matchType,
      });

      this.send(msg);
    });
  }

  onPush(handler: PushHandler): () => void {
    this.pushHandlers.add(handler);
    return () => { this.pushHandlers.delete(handler); };
  }
}

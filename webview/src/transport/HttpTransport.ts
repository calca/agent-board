/**
 * Transport implementation for the browser (mobile companion) environment.
 *
 * - `request()` maps message types to REST endpoints via `toHttpRequest()`.
 * - `onPush()` opens an SSE connection on `/events` for real-time updates,
 *   with automatic reconnection on error.
 */

import type { ITransport, PushHandler } from './ITransport';

function getApiBaseUrl(): string {
  return typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3333';
}

interface HttpMapping {
  method: string;
  url: string;
  body?: unknown;
}

/** Map a WebViewToHost-style message to a REST request. */
function toHttpRequest(msg: any): HttpMapping {
  const base = getApiBaseUrl();
  switch (msg.type) {
    case 'requestTasks':
      return { method: 'GET', url: `${base}/tasks` };
    case 'taskMoved':
      return { method: 'PATCH', url: `${base}/tasks/${msg.taskId}`, body: { status: msg.toCol } };
    case 'saveTask':
      return { method: 'POST', url: `${base}/tasks`, body: msg.data };
    case 'startAgent':
      return { method: 'POST', url: `${base}/agent/start`, body: { taskId: msg.taskId, provider: msg.provider, prompt: msg.prompt } };
    case 'cancelAgent':
      return { method: 'POST', url: `${base}/agent/cancel`, body: { taskId: msg.taskId } };
    default:
      return { method: 'POST', url: `${base}/messages`, body: msg };
  }
}

export class HttpTransport implements ITransport {
  private readonly pushHandlers = new Set<PushHandler>();
  private eventSource: EventSource | null = null;

  constructor() {
    this.connectSSE();
  }

  send(msg: any): void {
    const { method, url, body } = toHttpRequest(msg);
    fetch(url, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    }).catch(err => console.error('[HttpTransport] send error:', err));
  }

  async request<T = any>(
    msg: any & { requestId: string },
    _matchType: string,
    _timeoutMs = 5000,
  ): Promise<T> {
    const { method, url, body } = toHttpRequest(msg);
    const response = await fetch(url, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    return response.json();
  }

  onPush(handler: PushHandler): () => void {
    this.pushHandlers.add(handler);
    return () => { this.pushHandlers.delete(handler); };
  }

  // ── SSE ────────────────────────────────────────────────────────────

  private connectSSE(): void {
    if (typeof EventSource === 'undefined') { return; }
    const url = `${getApiBaseUrl()}/events`;
    this.eventSource = new EventSource(url);

    this.eventSource.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        for (const handler of this.pushHandlers) {
          handler(msg);
        }
      } catch {
        // ignore malformed events
      }
    };

    this.eventSource.onerror = () => {
      this.eventSource?.close();
      this.eventSource = null;
      // Auto-reconnect after 3 seconds
      setTimeout(() => this.connectSSE(), 3000);
    };
  }
}

/**
 * Common transport interface for WebView ↔ Host communication.
 *
 * Both VsCodeTransport and HttpTransport implement this contract
 * so the DataProvider can work in either environment transparently.
 */

export type PushHandler = (msg: any) => void;

export interface ITransport {
  /** Fire-and-forget message to the host. */
  send(msg: any): void;

  /**
   * Send a request and wait for a matching response.
   * The caller supplies a `requestId` inside `msg` so concurrent
   * requests can be routed independently.
   */
  request<T = any>(
    msg: any & { requestId: string },
    matchType: string,
    timeoutMs?: number,
  ): Promise<T>;

  /**
   * Subscribe to push events (messages not associated with a pending request).
   * Returns an unsubscribe function.
   */
  onPush(handler: PushHandler): () => void;
}

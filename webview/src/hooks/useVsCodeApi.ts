/**
 * Typed wrapper around the VS Code webview API injected at runtime.
 */

interface VsCodeApi {
  postMessage(msg: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

let _api: VsCodeApi | null | undefined;

export function getVsCodeApi(): VsCodeApi | null {
  if (_api !== undefined) {
    return _api;
  }

  try {
    if (typeof acquireVsCodeApi === 'function') {
      _api = acquireVsCodeApi();
      return _api;
    }
  } catch {
    // Not running in VS Code webview context.
  }

  _api = null;
  return _api;
}

export function postMessage(msg: unknown): void {
  getVsCodeApi()?.postMessage(msg);
}

/**
 * Typed wrapper around the VS Code webview API injected at runtime.
 */

interface VsCodeApi {
  postMessage(msg: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

let _api: VsCodeApi | undefined;

export function getVsCodeApi(): VsCodeApi {
  if (!_api) {
    _api = acquireVsCodeApi();
  }
  return _api;
}

export function postMessage(msg: unknown): void {
  getVsCodeApi().postMessage(msg);
}

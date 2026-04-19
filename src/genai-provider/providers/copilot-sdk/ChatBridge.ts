/**
 * Bridge between the CopilotEvent stream (extension side) and the
 * webview React chat UI.
 *
 * The controller:
 *  1. Subscribes to the provider's event stream.
 *  2. Converts each {@link CopilotEvent} to a {@link UIBlock} via the mapper.
 *  3. Posts the block to the webview panel as a `chatBlock` message.
 *
 * The webview receives `chatBlock` messages and dispatches the appropriate
 * action on the ChatContainer reducer.
 */
import * as vscode from 'vscode';
import type { CopilotEvent, UIBlock } from './types';
import { mapEventToBlock } from './eventMapper';

/** Messages sent from the extension to the webview for chat blocks. */
export type ChatBridgeMessage =
  | { type: 'chatBlock'; sessionId: string; block: UIBlock }
  | { type: 'chatStart'; sessionId: string }
  | { type: 'chatEnd'; sessionId: string }
  | { type: 'chatError'; sessionId: string; content: string };

/**
 * Create an event handler that bridges CopilotEvents to a webview panel.
 *
 * @param panel      The webview panel (or view) to post messages to.
 * @param sessionId  The session/task ID for message routing.
 * @returns A {@link CopilotEventHandler} to pass to an adapter's `run()`.
 */
export function createChatBridge(
  panel: vscode.WebviewPanel | vscode.WebviewView,
  sessionId: string,
): (event: CopilotEvent) => void {
  const post = (msg: ChatBridgeMessage) => {
    panel.webview.postMessage(msg);
  };

  // Signal the webview that a new assistant turn has started
  post({ type: 'chatStart', sessionId });

  return (event: CopilotEvent) => {
    if (event.type === 'end') {
      post({ type: 'chatEnd', sessionId });
      return;
    }

    if (event.type === 'error') {
      post({ type: 'chatError', sessionId, content: event.content });
    }

    const block = mapEventToBlock(event);
    if (block) {
      post({ type: 'chatBlock', sessionId, block });
    }
  };
}

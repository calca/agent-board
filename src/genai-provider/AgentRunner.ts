/**
 * AgentRunner — orchestrates GenAI provider execution and streams
 * output chunks to the WebView via KanbanPanel.postMessage.
 *
 * Uses the provider's `onDidStream` event + `AsyncQueue` to bridge
 * async iteration and event-based streaming.
 */
import type { KanbanPanel } from '../kanban/KanbanPanel';
import { formatError } from '../utils/errorUtils';
import { Logger } from '../utils/logger';
import { AsyncQueue } from './AsyncQueue';
import type { GenAiProviderRegistry } from './GenAiProviderRegistry';
import type { IGenAiProvider } from './IGenAiProvider';

const logger = Logger.getInstance();

/** Active providers keyed by taskId (for cancellation). */
const activeProviders = new Map<string, IGenAiProvider>();

/**
 * Start an agent run: resolve the GenAI provider from the registry,
 * subscribe to its `onDidStream` event, call `run()`, and forward
 * each chunk to the webview.
 */
export async function runAgent(
  panel: KanbanPanel,
  taskId: string,
  providerId: string,
  prompt: string,
  registry: GenAiProviderRegistry,
): Promise<void> {
  const provider = registry.get(providerId);
  if (!provider) {
    panel.postMessage({ type: 'agentError', taskId, error: `Unknown GenAI provider: ${providerId}` });
    return;
  }

  if (!provider.onDidStream) {
    panel.postMessage({ type: 'agentError', taskId, error: `Provider "${providerId}" does not support streaming.` });
    return;
  }

  activeProviders.set(taskId, provider);
  const queue = new AsyncQueue<string>();
  const subscription = provider.onDidStream((text) => queue.push(text));

  const runPromise = provider.run(prompt).then(() => {
    subscription.dispose();
    queue.end();
  }).catch((err) => {
    subscription.dispose();
    queue.throw(err instanceof Error ? err : new Error(String(err)));
  });

  try {
    for await (const chunk of queue) {
      panel.postMessage({ type: 'agentLog', taskId, chunk, done: false });
    }
    panel.postMessage({ type: 'agentLog', taskId, chunk: '', done: true });
  } catch (err) {
    const message = formatError(err);
    logger.error(`[AgentRunner] ${providerId} error for ${taskId}: ${message}`);
    panel.postMessage({ type: 'agentError', taskId, error: message });
  } finally {
    activeProviders.delete(taskId);
    await runPromise.catch(() => {});
  }
}

/** Cancel a running agent by taskId. */
export function cancelAgent(taskId: string): void {
  const provider = activeProviders.get(taskId);
  if (provider) {
    provider.cancel?.();
    activeProviders.delete(taskId);
  }
}

/**
 * Maps raw `@github/copilot-sdk` session events to the unified
 * {@link CopilotEvent} model.
 *
 * Event types from the SDK:
 *  - `assistant.message_delta` — streaming chunk with `deltaContent`
 *  - `assistant.message`       — final complete assistant message
 *  - `tool.execution_start`    — tool invocation begins
 *  - `tool.execution_complete` — tool invocation finishes
 *  - `user.message`            — user message echo
 *  - `session.idle`            — session finished processing
 */
import type { CopilotEventHandler } from './types';

/**
 * Shape of a raw session event from `@github/copilot-sdk`.
 * Kept loose for forward-compatibility.
 */
export interface RawSdkEvent {
  type: string;
  data?: {
    content?: string;
    deltaContent?: string;
    toolName?: string;
    name?: string;
    result?: unknown;
    output?: unknown;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

/**
 * Translate a single SDK session event and forward as a unified CopilotEvent.
 */
export function mapSdkEvent(e: RawSdkEvent, emit: CopilotEventHandler): void {
  switch (e.type) {
    case 'assistant.message_delta':
      emit({ type: 'message_delta', content: e.data?.deltaContent ?? '' });
      break;

    case 'assistant.message':
      emit({ type: 'message', content: e.data?.content ?? '' });
      break;

    case 'tool.execution_start':
      emit({ type: 'command', content: e.data?.toolName ?? e.data?.name ?? 'tool' });
      break;

    case 'tool.execution_complete': {
      const raw = e.data?.result ?? e.data?.output ?? '';
      const content = typeof raw === 'string' ? raw : JSON.stringify(raw);
      emit({ type: 'result', content });
      break;
    }

    case 'user.message':
      // Echoed back — ignore (already shown in the UI as user bubble)
      break;

    case 'session.idle':
      emit({ type: 'end' });
      break;

    case 'assistant.reasoning_delta':
    case 'assistant.reasoning':
      // Reasoning events — pass as step blocks
      emit({ type: 'step', label: e.data?.deltaContent ?? e.data?.content ?? 'reasoning…' });
      break;

    case 'session.compaction_start':
      emit({ type: 'step', label: 'Compacting context…' });
      break;

    case 'session.compaction_complete':
      emit({ type: 'step', label: 'Context compaction done' });
      break;

    // Unknown events are silently ignored — forward-compatible.
  }
}

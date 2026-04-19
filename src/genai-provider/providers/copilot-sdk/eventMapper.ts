/**
 * Maps a {@link CopilotEvent} to a {@link UIBlock}.
 *
 * This pure function is the single place where the streaming event
 * model is translated into the visual block model consumed by the
 * React chat UI.  Adding new event types only requires extending
 * the switch here.
 */
import type { CopilotEvent, UIBlock } from './types';

/**
 * Convert a single Copilot event to a UI block.
 *
 * Returns `undefined` for events that have no visual representation
 * (e.g. `end`).
 */
export function mapEventToBlock(event: CopilotEvent): UIBlock | undefined {
  switch (event.type) {
    case 'start':
      return undefined;

    case 'message':
      return { type: 'text', content: event.content };

    case 'message_delta':
      return { type: 'text', content: event.content, streaming: true };

    case 'command':
      return { type: 'command', content: event.content };

    case 'result':
      return { type: 'result', content: event.content };

    case 'step':
      return { type: 'step', label: event.label, status: 'running' };

    case 'error':
      return { type: 'text', content: `⚠ ${event.content}` };

    case 'end':
      return undefined;
  }
}

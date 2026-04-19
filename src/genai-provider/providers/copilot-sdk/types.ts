/**
 * Unified event and UI block model for the Copilot SDK migration.
 *
 * These types form the contract between any adapter (CLI or SDK)
 * and the webview UI, decoupling streaming output from presentation.
 */

// ── Copilot Events (adapter → controller) ──────────────────────────────

/** Discriminated union of all events emitted by a Copilot adapter. */
export type CopilotEvent =
  | { type: 'start' }
  | { type: 'message'; content: string }
  | { type: 'message_delta'; content: string }
  | { type: 'command'; content: string }
  | { type: 'result'; content: string }
  | { type: 'step'; label: string }
  | { type: 'error'; content: string }
  | { type: 'end' };

/** Callback signature for event consumers. */
export type CopilotEventHandler = (event: CopilotEvent) => void;

// ── UI Blocks (event → presentation) ───────────────────────────────────

/** Discriminated union of visual blocks rendered in the chat UI. */
export type UIBlock =
  | { type: 'text'; content: string; streaming?: boolean }
  | { type: 'code'; content: string; language?: string }
  | { type: 'command'; content: string }
  | { type: 'result'; content: string }
  | { type: 'step'; label: string; status?: 'running' | 'done' };

/** A single chat message composed of ordered visual blocks. */
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  blocks: UIBlock[];
  /** Wall-clock timestamp (ISO). */
  ts: string;
}

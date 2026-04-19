/**
 * Shared types for the chat UI blocks, mirroring the host-side copilot-sdk/types.ts.
 */

export type UIBlock =
  | { type: 'text'; content: string; streaming?: boolean }
  | { type: 'code'; content: string; language?: string }
  | { type: 'command'; content: string }
  | { type: 'result'; content: string }
  | { type: 'step'; label: string; status?: 'running' | 'done' };

export interface ChatBlockMessage {
  id: string;
  role: 'user' | 'assistant' | 'board';
  blocks: UIBlock[];
  ts: string;
}

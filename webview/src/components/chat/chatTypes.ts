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

// ── Chat state & reducer (shared by useHostMessages + ChatContainer) ──

export interface ChatState {
  messages: ChatBlockMessage[];
  isRunning: boolean;
}

export type ChatAction =
  | { type: 'USER_MESSAGE'; text: string }
  | { type: 'BOARD_MESSAGE'; text: string }
  | { type: 'APPEND_BLOCK'; block: UIBlock }
  | { type: 'FINISH_STEP'; label: string }
  | { type: 'START_ASSISTANT' }
  | { type: 'END_ASSISTANT' }
  | { type: 'RESET' };

let _nextId = 1;
function nextId(): string { return `msg-${_nextId++}`; }

export const EMPTY_CHAT_STATE: ChatState = { messages: [], isRunning: false };

export function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case 'USER_MESSAGE': {
      const msg: ChatBlockMessage = {
        id: nextId(),
        role: 'user',
        blocks: [{ type: 'text', content: action.text }],
        ts: new Date().toISOString(),
      };
      return { ...state, messages: [...state.messages, msg] };
    }
    case 'BOARD_MESSAGE': {
      const msg: ChatBlockMessage = {
        id: nextId(),
        role: 'board',
        blocks: [{ type: 'text', content: action.text }],
        ts: new Date().toISOString(),
      };
      return { ...state, messages: [...state.messages, msg] };
    }
    case 'START_ASSISTANT': {
      const msg: ChatBlockMessage = {
        id: nextId(),
        role: 'assistant',
        blocks: [],
        ts: new Date().toISOString(),
      };
      return { ...state, messages: [...state.messages, msg], isRunning: true };
    }
    case 'APPEND_BLOCK': {
      const msgs = [...state.messages];
      const last = msgs[msgs.length - 1];
      if (last && last.role === 'assistant') {
        const prevBlock = last.blocks[last.blocks.length - 1];
        if (
          action.block.type === 'text' &&
          action.block.streaming &&
          prevBlock?.type === 'text' &&
          prevBlock.streaming
        ) {
          const merged: UIBlock = { type: 'text', content: prevBlock.content + action.block.content, streaming: true };
          msgs[msgs.length - 1] = { ...last, blocks: [...last.blocks.slice(0, -1), merged] };
        } else {
          msgs[msgs.length - 1] = { ...last, blocks: [...last.blocks, action.block] };
        }
      }
      return { ...state, messages: msgs };
    }
    case 'FINISH_STEP': {
      const msgs = [...state.messages];
      const last = msgs[msgs.length - 1];
      if (last && last.role === 'assistant') {
        const blocks = last.blocks.map(b =>
          b.type === 'step' && b.label === action.label ? { ...b, status: 'done' as const } : b,
        );
        msgs[msgs.length - 1] = { ...last, blocks };
      }
      return { ...state, messages: msgs };
    }
    case 'END_ASSISTANT': {
      const msgs = [...state.messages];
      const last = msgs[msgs.length - 1];
      if (last && last.role === 'assistant') {
        const blocks = last.blocks.map(b => {
          if (b.type === 'text' && b.streaming) { return { ...b, streaming: false }; }
          if (b.type === 'step' && b.status !== 'done') { return { ...b, status: 'done' as const }; }
          return b;
        });
        msgs[msgs.length - 1] = { ...last, blocks };
      }
      return { ...state, messages: msgs, isRunning: false };
    }
    case 'RESET':
      return EMPTY_CHAT_STATE;
    default:
      return state;
  }
}

import { useCallback, useEffect, useReducer } from 'react';
import { postMessage } from '../../hooks/useVsCodeApi';
import type { ChatBlockMessage, UIBlock } from './chatTypes';
import { InputBox } from './InputBox';
import { MessageList } from './MessageList';

// ── State ────────────────────────────────────────────────────────────────

interface ChatState {
  messages: ChatBlockMessage[];
  isRunning: boolean;
}

type ChatAction =
  | { type: 'USER_MESSAGE'; text: string }
  | { type: 'BOARD_MESSAGE'; text: string }
  | { type: 'APPEND_BLOCK'; block: UIBlock }
  | { type: 'FINISH_STEP'; label: string }
  | { type: 'START_ASSISTANT' }
  | { type: 'END_ASSISTANT' }
  | { type: 'RESET' };

let _nextId = 1;
function nextId(): string { return `msg-${_nextId++}`; }

function chatReducer(state: ChatState, action: ChatAction): ChatState {
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
        // Merge consecutive text deltas into a single block
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
        // Mark all streaming text as complete, all steps as done
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
      return { messages: [], isRunning: false };
    default:
      return state;
  }
}

// ── Component ────────────────────────────────────────────────────────────

interface ChatContainerProps {
  sessionId: string;
}

export function ChatContainer({ sessionId }: ChatContainerProps) {
  const [state, dispatch] = useReducer(chatReducer, { messages: [], isRunning: false });

  // Subscribe to host messages for this session
  useEffect(() => {
    function handleMessage(e: MessageEvent) {
      const msg = e.data;
      if (!msg || typeof msg.type !== 'string') { return; }
      if (msg.sessionId !== sessionId) { return; }

      switch (msg.type) {
        case 'chatPrompt':
          dispatch({ type: 'BOARD_MESSAGE', text: msg.prompt as string });
          break;
        case 'chatBoardEvent':
          dispatch({ type: 'BOARD_MESSAGE', text: msg.text as string });
          break;
        case 'chatStart':
          dispatch({ type: 'START_ASSISTANT' });
          break;
        case 'chatBlock':
          dispatch({ type: 'APPEND_BLOCK', block: msg.block as UIBlock });
          break;
        case 'chatEnd':
          dispatch({ type: 'END_ASSISTANT' });
          break;
        case 'chatError':
          dispatch({ type: 'APPEND_BLOCK', block: { type: 'text', content: `⚠ ${msg.content}` } });
          dispatch({ type: 'END_ASSISTANT' });
          break;
      }
    }
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [sessionId]);

  const handleSend = useCallback((text: string) => {
    dispatch({ type: 'USER_MESSAGE', text });
    postMessage({ type: 'sendFollowUp', sessionId, text });
  }, [sessionId]);

  const handleStop = useCallback(() => {
    postMessage({ type: 'cancelSession', taskId: sessionId });
  }, [sessionId]);

  return (
    <div className="cb-container">
      <MessageList messages={state.messages} />
      <InputBox
        onSend={handleSend}
        onStop={handleStop}
        isRunning={state.isRunning}
        placeholder="Send a message…"
      />
    </div>
  );
}

/** Expose dispatch type for the bridge to call from message handlers. */
export type { ChatAction };

import { useCallback } from 'react';
import { useBoard } from '../../context/BoardContext';
import { postMessage } from '../../hooks/useVsCodeApi';
import { chatReducer, EMPTY_CHAT_STATE } from './chatTypes';
import { InputBox } from './InputBox';
import { MessageList } from './MessageList';

// ── Component ────────────────────────────────────────────────────────────

interface ChatContainerProps {
  sessionId: string;
}

/**
 * Reads chat state from `imp.current.chatStates` (persisted across mount/unmount).
 * Host messages are processed by `useHostMessages` into that store.
 * User messages are applied locally and synced back.
 */
export function ChatContainer({ sessionId }: ChatContainerProps) {
  const { imp, forceUpdate } = useBoard();
  const state = imp.current.chatStates.get(sessionId) ?? EMPTY_CHAT_STATE;

  const handleSend = useCallback((text: string) => {
    const prev = imp.current.chatStates.get(sessionId) ?? EMPTY_CHAT_STATE;
    imp.current.chatStates.set(sessionId, chatReducer(prev, { type: 'USER_MESSAGE', text }));
    forceUpdate();
    postMessage({ type: 'sendFollowUp', sessionId, text });
  }, [sessionId, imp, forceUpdate]);

  const handleStop = useCallback(() => {
    postMessage({ type: 'cancelSession', taskId: sessionId });
  }, [sessionId]);

  return (
    <div className="cb-container">
      <MessageList messages={state.messages} isRunning={state.isRunning} />
      <InputBox
        onSend={handleSend}
        onStop={handleStop}
        isRunning={state.isRunning}
        placeholder="Send a message…"
      />
    </div>
  );
}

import { useCallback, useEffect, useRef } from 'react';
import Markdown from 'react-markdown';
import type { AgentChatMessage } from '../types';

// ── Sub-components ──────────────────────────────────────────────────────

function StreamCursor() {
  return <span className="acl__cursor" />;
}

function TypingIndicator() {
  return (
    <div className="acl__typing">
      <span /><span /><span />
    </div>
  );
}

function BubbleAvatar({ role }: { role: AgentChatMessage['role'] }) {
  const label = role === 'user' ? '👤' : role === 'agent' ? '◆' : 'ⓘ';
  return <span className="acl__avatar">{label}</span>;
}

function ChatBubble({ msg }: { msg: AgentChatMessage }) {
  const isUser = msg.role === 'user';
  const isSystem = msg.role === 'system';

  return (
    <div className={`acl__bubble acl__bubble--${msg.role}`}>
      {!isUser && <BubbleAvatar role={msg.role} />}
      <div className="acl__bubble-content">
        {isUser ? (
          <p>{msg.text}</p>
        ) : isSystem ? (
          <p className="acl__system-text">{msg.text}</p>
        ) : (
          <>
            <Markdown>{msg.text}</Markdown>
            {!msg.done && <StreamCursor />}
          </>
        )}
      </div>
      {isUser && <BubbleAvatar role={msg.role} />}
    </div>
  );
}

// ── Main component ──────────────────────────────────────────────────────

interface AgentChatLogProps {
  messages: AgentChatMessage[];
  isRunning: boolean;
}

export function AgentChatLog({ messages, isRunning }: AgentChatLogProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const autoScrollRef = useRef(true);

  const handleScroll = useCallback(() => {
    if (scrollRef.current) {
      const el = scrollRef.current;
      autoScrollRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    }
  }, []);

  useEffect(() => {
    if (autoScrollRef.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  });

  const showTyping = isRunning && (messages.length === 0 || messages[messages.length - 1]?.done);

  return (
    <div className="acl" ref={scrollRef} onScroll={handleScroll}>
      {messages.map(msg => (
        <ChatBubble key={msg.id} msg={msg} />
      ))}
      {showTyping && <TypingIndicator />}
      {messages.length === 0 && !isRunning && (
        <div className="acl__empty">No agent activity yet. Launch a CLI provider to begin.</div>
      )}
    </div>
  );
}

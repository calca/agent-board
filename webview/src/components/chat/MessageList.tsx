import { useCallback, useEffect, useRef } from 'react';
import type { ChatBlockMessage } from './chatTypes';
import { MessageBubble } from './MessageBubble';

interface MessageListProps {
  messages: ChatBlockMessage[];
}

export function MessageList({ messages }: MessageListProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const autoScrollRef = useRef(true);

  const handleScroll = useCallback(() => {
    if (scrollRef.current) {
      const el = scrollRef.current;
      autoScrollRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    }
  }, []);

  // Auto-scroll on new messages
  useEffect(() => {
    if (autoScrollRef.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  });

  return (
    <div className="cb-message-list" ref={scrollRef} onScroll={handleScroll}>
      {messages.length === 0 && (
        <div className="cb-message-list__empty">Start a conversation…</div>
      )}
      {messages.map(msg => (
        <MessageBubble key={msg.id} message={msg} />
      ))}
    </div>
  );
}

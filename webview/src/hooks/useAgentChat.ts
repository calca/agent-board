import { useCallback, useEffect, useState } from 'react';
import { DataProvider } from '../DataProvider';
import type { AgentChatMessage } from '../types';

let nextMsgId = 0;
function msgId(): string {
  return `acm-${Date.now()}-${nextMsgId++}`;
}

/**
 * Hook that manages the agent chat message list for a given task.
 *
 * Subscribes to `DataProvider.onAgentLog` and `onAgentError`,
 * accumulates chunks into the current agent message, and exposes
 * `sendUserMessage` / `appendSystem` for programmatic additions.
 */
export function useAgentChat(taskId: string | undefined): {
  messages: AgentChatMessage[];
  isRunning: boolean;
  sendUserMessage: (text: string) => void;
  appendSystem: (text: string) => void;
} {
  const [messages, setMessages] = useState<AgentChatMessage[]>([]);
  const [isRunning, setIsRunning] = useState(false);

  // Reset when taskId changes
  useEffect(() => {
    setMessages([]);
    setIsRunning(false);
  }, [taskId]);

  // Subscribe to agent log / error events
  useEffect(() => {
    if (!taskId) { return; }

    const unsubLog = DataProvider.onAgentLog(taskId, (chunk, done) => {
      setIsRunning(!done);
      setMessages(prev => {
        const last = prev[prev.length - 1];
        if (last && last.role === 'agent' && !last.done) {
          // Append chunk to existing agent message
          const updated = { ...last, text: last.text + chunk, done };
          return [...prev.slice(0, -1), updated];
        }
        if (chunk || !done) {
          // New agent message
          return [...prev, { id: msgId(), role: 'agent', text: chunk, done, ts: new Date().toISOString() }];
        }
        return prev;
      });
    });

    const unsubErr = DataProvider.onAgentError(taskId, (error) => {
      setIsRunning(false);
      setMessages(prev => [
        ...prev,
        { id: msgId(), role: 'system', text: `Error: ${error}`, done: true, ts: new Date().toISOString() },
      ]);
    });

    return () => { unsubLog(); unsubErr(); };
  }, [taskId]);

  const sendUserMessage = useCallback((text: string) => {
    if (!text.trim()) { return; }
    setMessages(prev => [
      ...prev,
      { id: msgId(), role: 'user', text, done: true, ts: new Date().toISOString() },
    ]);
  }, []);

  const appendSystem = useCallback((text: string) => {
    setMessages(prev => [
      ...prev,
      { id: msgId(), role: 'system', text, done: true, ts: new Date().toISOString() },
    ]);
  }, []);

  return { messages, isRunning, sendUserMessage, appendSystem };
}

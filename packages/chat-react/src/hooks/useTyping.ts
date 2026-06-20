import { useCallback, useEffect, useRef, useState } from 'react';
import { useChatContext } from '../context/ChatContext';

export interface UseTypingReturn {
  typingUserIds: string[];
  notifyTyping: () => void;
  stopTyping: () => void;
}

export function useTyping(conversationId: string): UseTypingReturn {
  const { engine } = useChatContext();
  const [typingUserIds, setTypingUserIds] = useState<string[]>([]);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;

    const unsub = engine.subscribeTyping(conversationId);

    const unsubEvent = engine.on('typing:updated', (event) => {
      if (!mountedRef.current) return;
      if (event.payload.conversation_id !== conversationId) return;

      setTypingUserIds(engine.getTypingUsers(conversationId));
    });

    return () => {
      mountedRef.current = false;
      unsub();
      unsubEvent();
    };
  }, [engine, conversationId]);

  const notifyTyping = useCallback(() => {
    void engine.notifyTyping(conversationId);
  }, [engine, conversationId]);

  const stopTyping = useCallback(() => {
    void engine.stopTyping(conversationId);
  }, [engine, conversationId]);

  return { typingUserIds, notifyTyping, stopTyping };
}

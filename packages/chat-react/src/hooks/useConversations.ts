import { useCallback, useEffect, useRef, useState } from 'react';
import type { Conversation } from '@somni/chat-core';
import { useChatContext } from '../context/ChatContext';

export interface UseConversationsReturn {
  conversations: Conversation[];
  isLoading: boolean;
  hasMore: boolean;
  loadMore: () => Promise<void>;
  refresh: () => Promise<void>;
}

export function useConversations(pageSize = 30): UseConversationsReturn {
  const { engine } = useChatContext();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const cursorRef = useRef<string | null>(null);
  const mountedRef = useRef(true);

  const fetch = useCallback(
    async (cursor?: string) => {
      const result = await engine.listConversations({ limit: pageSize, cursor });
      if (!mountedRef.current) return;

      if (cursor) {
        setConversations((prev) => [...prev, ...result.items]);
      } else {
        setConversations(result.items);
      }
      setHasMore(result.has_more);
      cursorRef.current = result.next_cursor;
    },
    [engine, pageSize]
  );

  const loadMore = useCallback(async () => {
    if (!hasMore || !cursorRef.current) return;
    await fetch(cursorRef.current);
  }, [fetch, hasMore]);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    cursorRef.current = null;
    await fetch();
    setIsLoading(false);
  }, [fetch]);

  useEffect(() => {
    mountedRef.current = true;

    void (async () => {
      setIsLoading(true);
      await fetch();
      if (mountedRef.current) setIsLoading(false);
    })();

    const unsub = engine.subscribeConversations((event) => {
      if (!mountedRef.current) return;
      if (event.type === 'conversation:updated') {
        setConversations((prev) => {
          const exists = prev.find((c) => c.id === event.payload.id);
          if (!exists) return [event.payload, ...prev];
          return prev
            .map((c) => (c.id === event.payload.id ? event.payload : c))
            .sort((a, b) => {
              const ta = a.last_message_at ?? a.created_at;
              const tb = b.last_message_at ?? b.created_at;
              return tb.localeCompare(ta);
            });
        });
      } else if (event.type === 'conversation:deleted') {
        setConversations((prev) => prev.filter((c) => c.id !== event.payload.id));
      }
    });

    return () => {
      mountedRef.current = false;
      unsub();
    };
  }, [engine, fetch]);

  return { conversations, isLoading, hasMore, loadMore, refresh };
}

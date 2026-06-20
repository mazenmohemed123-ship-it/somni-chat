import { useCallback, useEffect, useRef, useState } from 'react';
import type { AnyMessage, ChatEvent } from '@somni/chat-core';
import { useChatContext } from '../context/ChatContext';

/**
 * Server-consistent ordering: sort by created_at, breaking ties on id so the
 * order is stable and identical across all clients (optimistic messages keep
 * their client_id as id until reconciled, which preserves their slot).
 */
function sortMessages(messages: AnyMessage[]): AnyMessage[] {
  return messages.slice().sort((a, b) => {
    if (a.created_at !== b.created_at) return a.created_at < b.created_at ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

export interface UseMessagesOptions {
  conversationId: string;
  pageSize?: number;
  autoSubscribe?: boolean;
}

export interface UseMessagesReturn {
  messages: AnyMessage[];
  isLoading: boolean;
  hasMore: boolean;
  loadMore: () => Promise<void>;
  refresh: () => Promise<void>;
}

export function useMessages({
  conversationId,
  pageSize = 50,
  autoSubscribe = true,
}: UseMessagesOptions): UseMessagesReturn {
  const { engine } = useChatContext();
  const [messages, setMessages] = useState<AnyMessage[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const cursorRef = useRef<string | null>(null);
  const mountedRef = useRef(true);

  const fetchMessages = useCallback(
    async (cursor?: string) => {
      const result = await engine.listMessages(conversationId, {
        limit: pageSize,
        cursor,
        direction: 'desc',
      });

      if (!mountedRef.current) return;

      if (cursor) {
        setMessages((prev) => [...result.items, ...prev]);
      } else {
        setMessages(result.items);
      }
      setHasMore(result.has_more);
      cursorRef.current = result.next_cursor;
    },
    [engine, conversationId, pageSize]
  );

  const loadMore = useCallback(async () => {
    if (!hasMore || !cursorRef.current) return;
    await fetchMessages(cursorRef.current);
  }, [fetchMessages, hasMore]);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    cursorRef.current = null;
    await fetchMessages();
    setIsLoading(false);
  }, [fetchMessages]);

  useEffect(() => {
    mountedRef.current = true;

    void (async () => {
      setIsLoading(true);
      await fetchMessages();
      if (mountedRef.current) setIsLoading(false);
    })();

    let unsubscribe: (() => void) | undefined;

    if (autoSubscribe) {
      unsubscribe = engine.subscribeMessages(conversationId, (event: ChatEvent) => {
        if (!mountedRef.current) return;

        if (event.type === 'message:new') {
          setMessages((prev) => {
            // Dedup by client_id OR server id (covers optimistic + echo).
            const exists = prev.some(
              (m) => m.client_id === event.payload.client_id || m.id === event.payload.id
            );
            if (exists) return prev;
            return sortMessages([...prev, event.payload]);
          });
        } else if (event.type === 'message:updated') {
          setMessages((prev) => {
            // Match the optimistic placeholder by client_id, else by server id.
            const idx = prev.findIndex(
              (m) => m.client_id === event.payload.client_id || m.id === event.payload.id
            );
            if (idx === -1) {
              // Update for a message we don't have yet → insert (reconciliation safety).
              return sortMessages([...prev, event.payload]);
            }
            const next = prev.slice();
            next[idx] = event.payload;
            return sortMessages(next);
          });
        } else if (event.type === 'message:deleted') {
          setMessages((prev) => prev.filter((m) => m.id !== event.payload.id));
        }
      });
    }

    return () => {
      mountedRef.current = false;
      unsubscribe?.();
    };
  }, [engine, conversationId, autoSubscribe, fetchMessages]);

  return { messages, isLoading, hasMore, loadMore, refresh };
}

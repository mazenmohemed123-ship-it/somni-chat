import { useEffect, useRef, useState } from 'react';
import type { UserPresence } from '@somni/chat-core';
import { useChatContext } from '../context/ChatContext';

export interface UsePresenceReturn {
  presence: Map<string, UserPresence>;
  isOnline: (userId: string) => boolean;
}

export function usePresence(userIds: string[]): UsePresenceReturn {
  const { engine } = useChatContext();
  const [presence, setPresence] = useState<Map<string, UserPresence>>(new Map());
  const mountedRef = useRef(true);
  const sortedIds = [...userIds].sort().join(',');

  useEffect(() => {
    mountedRef.current = true;
    const ids = sortedIds ? sortedIds.split(',') : [];
    if (!ids.length) return;

    void engine.fetchPresence(ids).then((presences) => {
      if (!mountedRef.current) return;
      setPresence(new Map(presences.map((p) => [p.user_id, p])));
    });

    const unsub = engine.subscribePresence(ids);
    const unsubEvent = engine.on('presence:updated', (event) => {
      if (!mountedRef.current) return;
      setPresence((prev) => {
        const next = new Map(prev);
        next.set(event.payload.user_id, event.payload);
        return next;
      });
    });

    return () => {
      mountedRef.current = false;
      unsub();
      unsubEvent();
    };
  }, [engine, sortedIds]);

  return {
    presence,
    isOnline: (userId: string) => presence.get(userId)?.status === 'online',
  };
}

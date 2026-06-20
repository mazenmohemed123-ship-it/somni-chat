import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { ChatEngine } from '@somni/chat-core';

interface ChatContextValue {
  engine: ChatEngine;
  isConnected: boolean;
  isReconnecting: boolean;
}

const ChatContext = createContext<ChatContextValue | null>(null);

export interface ChatProviderProps {
  engine: ChatEngine;
  children: ReactNode;
  autoConnect?: boolean;
}

export function ChatProvider({ engine, children, autoConnect = true }: ChatProviderProps) {
  const [isConnected, setIsConnected] = useState(false);
  const [isReconnecting, setIsReconnecting] = useState(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;

    const unsubConnected = engine.on('connection:connected', () => {
      if (mounted.current) {
        setIsConnected(true);
        setIsReconnecting(false);
      }
    });

    const unsubDisconnected = engine.on('connection:disconnected', () => {
      if (mounted.current) setIsConnected(false);
    });

    const unsubReconnecting = engine.on('connection:reconnecting', () => {
      if (mounted.current) setIsReconnecting(true);
    });

    if (autoConnect) {
      void engine.connect();
    }

    return () => {
      mounted.current = false;
      unsubConnected();
      unsubDisconnected();
      unsubReconnecting();
      void engine.disconnect();
    };
  }, [engine, autoConnect]);

  return (
    <ChatContext.Provider value={{ engine, isConnected, isReconnecting }}>
      {children}
    </ChatContext.Provider>
  );
}

export function useChatContext(): ChatContextValue {
  const ctx = useContext(ChatContext);
  if (!ctx) {
    throw new Error('useChatContext must be used within a <ChatProvider>');
  }
  return ctx;
}

import { useChatContext } from '../context/ChatContext';
import type { ChatEngine } from '@somni/chat-core';

export interface UseChatEngineReturn {
  engine: ChatEngine;
  isConnected: boolean;
  isReconnecting: boolean;
  userId: string;
}

export function useChatEngine(): UseChatEngineReturn {
  const { engine, isConnected, isReconnecting } = useChatContext();
  return { engine, isConnected, isReconnecting, userId: engine.userId };
}

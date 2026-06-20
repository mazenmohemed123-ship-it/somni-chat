import { useCallback, useState } from 'react';
import type { AnyMessage, SendMessageInput } from '@somni/chat-core';
import { useChatContext } from '../context/ChatContext';

export interface UseSendMessageReturn {
  sendMessage: (input: Omit<SendMessageInput, 'client_id'>) => Promise<AnyMessage>;
  isSending: boolean;
  error: Error | null;
  clearError: () => void;
}

export function useSendMessage(): UseSendMessageReturn {
  const { engine } = useChatContext();
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const sendMessage = useCallback(
    async (input: Omit<SendMessageInput, 'client_id'>): Promise<AnyMessage> => {
      setIsSending(true);
      setError(null);
      try {
        const message = await engine.sendMessage(input);
        return message;
      } catch (err) {
        const e = err instanceof Error ? err : new Error('Failed to send message');
        setError(e);
        throw e;
      } finally {
        setIsSending(false);
      }
    },
    [engine]
  );

  const clearError = useCallback(() => setError(null), []);

  return { sendMessage, isSending, error, clearError };
}

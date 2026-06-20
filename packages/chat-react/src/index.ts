// Context & Provider
export { ChatProvider, useChatContext } from './context/ChatContext';
export type { ChatProviderProps } from './context/ChatContext';

// Hooks
export { useChatEngine } from './hooks/useChatEngine';
export { useMessages } from './hooks/useMessages';
export { useConversations } from './hooks/useConversations';
export { useTyping } from './hooks/useTyping';
export { usePresence } from './hooks/usePresence';
export { useSendMessage } from './hooks/useSendMessage';

// Re-export core types for convenience
export type {
  ChatEngine,
  ChatEngineConfig,
  Message,
  AnyMessage,
  Conversation,
  Participant,
  UserPresence,
  SendMessageInput,
  MessageType,
  ConversationType,
} from '@somni/chat-core';

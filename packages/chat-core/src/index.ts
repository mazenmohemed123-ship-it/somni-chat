// Public API for @somni/chat-core
export { ChatEngine, createChat } from './engine/ChatEngine';
export { ChatEventEmitter } from './engine/EventEmitter';
export type { ChatAdapter, PaginationOptions, MessageQueryOptions, PaginatedResult, UnsubscribeFn } from './adapter/ChatAdapter';

// Types
export type {
  Conversation,
  ConversationType,
  ConversationStatus,
  CreateConversationInput,
  UpdateConversationInput,
} from './types/conversation';

export type {
  Participant,
  ParticipantRole,
  ParticipantStatus,
  AddParticipantInput,
} from './types/participant';

export type {
  Message,
  Attachment,
  Reaction,
  SendMessageInput,
  EditMessageInput,
  OptimisticMessage,
  AnyMessage,
  MessageType,
  MessageStatus,
  AttachmentInput,
} from './types/message';

export type {
  UserPresence,
  PresenceStatus,
  TypingIndicator,
  PresenceUpdate,
  TypingUpdate,
} from './types/presence';

export type {
  ChatEvent,
  ChatEventType,
  ChatEventPayload,
  EventListener,
} from './types/events';

export type { ChatEngineConfig, ChatPlugin } from './types/config';

// Utilities
export { generateId, isValidUUID } from './utils/uuid';
export { DeduplicationCache } from './utils/deduplication';
export { OfflineQueue } from './utils/offlineQueue';

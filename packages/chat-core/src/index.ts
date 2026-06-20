// Public API for @somni/chat-core
export { ChatEngine, createChat } from './engine/ChatEngine';
export type { ConnectionState } from './engine/ChatEngine';
export { ChatEventEmitter } from './engine/EventEmitter';
export { PluginManager } from './engine/PluginManager';
export { SubscriptionRegistry } from './engine/SubscriptionRegistry';

// Adapter contract + validation
export type {
  ChatAdapter,
  PaginationOptions,
  MessageQueryOptions,
  PaginatedResult,
  UnsubscribeFn,
  UploadAttachmentInput,
  UploadAttachmentResult,
} from './adapter/ChatAdapter';
export {
  validateAdapter,
  isAdapterCompliant,
  AdapterComplianceError,
  REQUIRED_ADAPTER_METHODS,
} from './adapter/validateAdapter';

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

export type {
  ChatEngineConfig,
  ChatPlugin,
  PluginContext,
  BeforeSendResult,
  ReconnectConfig,
  OfflineConfig,
} from './types/config';

// Utilities
export { generateId, isValidUUID } from './utils/uuid';
export { DeduplicationCache } from './utils/deduplication';
export { OfflineQueue } from './utils/offlineQueue';
export type { QueuedOperation, OfflineQueueOptions, PersistentStorage } from './utils/offlineQueue';
export { validateMessageInput, sanitizeContent, ValidationError } from './utils/validation';
export type { MessageValidationOptions } from './utils/validation';
export { computeBackoff, sleep, DEFAULT_BACKOFF } from './utils/backoff';
export type { BackoffConfig } from './utils/backoff';

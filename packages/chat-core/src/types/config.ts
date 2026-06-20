import type { ChatAdapter } from '../adapter/ChatAdapter';
import type { Message, SendMessageInput, AnyMessage } from './message';
import type { UserPresence, TypingIndicator } from './presence';
import type { MessageValidationOptions } from '../utils/validation';

export interface ReconnectConfig {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  /** Jitter ratio 0..1 applied to each backoff delay (default: 0.3) */
  jitter?: number;
}

export interface OfflineConfig {
  enabled: boolean;
  /** Attempts before a queued message is dead-lettered (default: 8) */
  maxRetries?: number;
}

export interface ChatEngineConfig {
  /** Backend adapter (Supabase, Appwrite, Firebase, Custom) */
  adapter: ChatAdapter;

  /**
   * Current authenticated user ID. Optional here — you may instead pass it to
   * `connect(userId)`. One of the two is required before sending.
   */
  userId?: string;

  /** Typing indicator auto-stop timeout in ms (default: 3000) */
  typingTimeoutMs?: number;

  /** Presence heartbeat interval in ms (default: 30000) */
  presenceIntervalMs?: number;

  /** Reconnect backoff config */
  reconnect?: Partial<ReconnectConfig>;

  /**
   * Offline queue config. Pass `true`/`false` for the simple toggle, or an
   * object for fine-grained control.
   */
  offlineQueue?: boolean | OfflineConfig;

  /** Max messages fetched per page (default: 50) */
  messagePageSize?: number;

  /** Validation rules applied to every outgoing message */
  validation?: MessageValidationOptions;

  /** Skip runtime adapter-compliance check (not recommended) */
  skipAdapterValidation?: boolean;

  /** Plugin hooks for extensibility */
  plugins?: ChatPlugin[];
}

/**
 * Result of an `onBeforeSend` hook.
 *  - return a (possibly modified) input to continue
 *  - return `false` to BLOCK the message (it will never be sent)
 */
export type BeforeSendResult = Omit<SendMessageInput, 'client_id'> | false;

/**
 * Strongly-typed plugin contract. Every hook is optional. Hooks run in
 * registration order; async hooks are awaited.
 */
export interface ChatPlugin {
  name: string;

  /** Mutate or block an outgoing message before it is sent/queued. */
  onBeforeSend?: (
    input: Omit<SendMessageInput, 'client_id'>,
    ctx: PluginContext
  ) => BeforeSendResult | Promise<BeforeSendResult>;

  /** Observe a message after it was successfully persisted. */
  onAfterSend?: (message: Message, ctx: PluginContext) => void | Promise<void>;

  /** Transform an inbound realtime message before it reaches the UI. */
  onMessageReceive?: (
    message: AnyMessage,
    ctx: PluginContext
  ) => AnyMessage | Promise<AnyMessage>;

  /** React to presence changes (e.g. analytics, notifications). */
  onPresenceChange?: (presence: UserPresence, ctx: PluginContext) => void;

  /** React to typing changes. */
  onTyping?: (
    typing: TypingIndicator & { is_typing: boolean },
    ctx: PluginContext
  ) => void;
}

export interface PluginContext {
  readonly userId: string;
  readonly conversationId?: string;
}

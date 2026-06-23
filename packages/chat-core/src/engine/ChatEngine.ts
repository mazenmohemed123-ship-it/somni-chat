import type {
  ChatAdapter,
  PaginationOptions,
  MessageQueryOptions,
  PaginatedResult,
  UploadAttachmentInput,
  UploadAttachmentResult,
  UnsubscribeFn,
} from '../adapter/ChatAdapter';
import type { ChatEngineConfig, ReconnectConfig, PluginContext } from '../types/config';
import type { Conversation, CreateConversationInput, UpdateConversationInput } from '../types/conversation';
import type { Participant, AddParticipantInput } from '../types/participant';
import type { Message, SendMessageInput, EditMessageInput, Reaction, AnyMessage } from '../types/message';
import type { UserPresence, PresenceStatus } from '../types/presence';
import type { ChatEventType, EventListener, ChatEvent } from '../types/events';
import type { MessageValidationOptions } from '../utils/validation';

import { ChatEventEmitter } from './EventEmitter';
import { PresenceManager } from './PresenceManager';
import { TypingManager } from './TypingManager';
import { PluginManager } from './PluginManager';
import { SubscriptionRegistry } from './SubscriptionRegistry';
import { DeduplicationCache } from '../utils/deduplication';
import { OfflineQueue } from '../utils/offlineQueue';
import { generateId } from '../utils/uuid';
import { validateMessageInput } from '../utils/validation';
import { computeBackoff } from '../utils/backoff';
import { validateAdapter } from '../adapter/validateAdapter';

export type ConnectionState = 'idle' | 'connecting' | 'connected' | 'disconnected' | 'reconnecting';

interface ResolvedConfig {
  typingTimeoutMs: number;
  presenceIntervalMs: number;
  messagePageSize: number;
  offlineEnabled: boolean;
  offlineMaxRetries: number;
  reconnect: ReconnectConfig;
  validation: MessageValidationOptions;
}

/**
 * The framework-agnostic chat engine. Owns connection lifecycle, optimistic
 * sends, deduplication/reconciliation, the offline queue, plugins, presence and
 * typing — delegating all I/O to a pluggable {@link ChatAdapter}.
 */
export class ChatEngine {
  readonly events: ChatEventEmitter;

  private connectionState: ConnectionState = 'idle';
  private currentUserId: string | null;
  private reconnectAttempts = 0;
  private reconnectScheduled = false;
  private draining = false;
  private drainTimer: ReturnType<typeof setTimeout> | null = null;

  private readonly adapter: ChatAdapter;
  private readonly cfg: ResolvedConfig;
  private readonly dedup: DeduplicationCache;
  private readonly offlineQueue: OfflineQueue;
  private readonly plugins: PluginManager;
  private readonly messageSubs = new SubscriptionRegistry();
  private presenceManager: PresenceManager | null = null;
  private typingManager: TypingManager | null = null;

  constructor(config: ChatEngineConfig) {
    this.adapter = config.adapter;
    if (!config.skipAdapterValidation) {
      validateAdapter(this.adapter);
    }

    const offline =
      typeof config.offlineQueue === 'object'
        ? { enabled: config.offlineQueue.enabled, maxRetries: config.offlineQueue.maxRetries ?? 8 }
        : { enabled: config.offlineQueue !== false, maxRetries: 8 };

    this.cfg = {
      typingTimeoutMs: config.typingTimeoutMs ?? 3000,
      presenceIntervalMs: config.presenceIntervalMs ?? 30_000,
      messagePageSize: config.messagePageSize ?? 50,
      offlineEnabled: offline.enabled,
      offlineMaxRetries: offline.maxRetries,
      reconnect: {
        maxAttempts: config.reconnect?.maxAttempts ?? 10,
        baseDelayMs: config.reconnect?.baseDelayMs ?? 1000,
        maxDelayMs: config.reconnect?.maxDelayMs ?? 30_000,
        jitter: config.reconnect?.jitter ?? 0.3,
      },
      validation: config.validation ?? {},
    };

    this.currentUserId = config.userId ?? null;
    this.events = new ChatEventEmitter();
    this.dedup = new DeduplicationCache();
    this.offlineQueue = new OfflineQueue({ maxRetries: this.cfg.offlineMaxRetries });
    this.plugins = new PluginManager(config.plugins ?? []);
  }

  // ─── Identity ───────────────────────────────────────────────────────────────

  get userId(): string {
    if (!this.currentUserId) {
      throw new Error('[Somni] No userId set. Pass it to createChat({ userId }) or connect(userId).');
    }
    return this.currentUserId;
  }

  get state(): ConnectionState {
    return this.connectionState;
  }

  get isConnected(): boolean {
    return this.connectionState === 'connected';
  }

  /**
   * Returns a Promise that resolves the next time (or immediately, if already)
   * the engine reaches `connected`. Useful for lazy consumers that need to wait
   * for the connection before their first operation.
   */
  onceConnected(): Promise<void> {
    if (this.connectionState === 'connected') return Promise.resolve();
    return new Promise((resolve) => {
      const off = this.events.on('connection:connected', () => {
        off();
        resolve();
      });
    });
  }

  private get ctx(): PluginContext {
    return { userId: this.currentUserId ?? '' };
  }

  // ─── Lifecycle ────────────────────────────────────────────────────────────

  async connect(userId?: string): Promise<void> {
    if (userId) this.currentUserId = userId;
    if (!this.currentUserId) {
      throw new Error('[Somni] connect() requires a userId (via config or argument).');
    }
    if (this.connectionState === 'connected' || this.connectionState === 'connecting') return;

    this.connectionState = 'connecting';

    // Managers are bound to the resolved userId.
    this.presenceManager ??= new PresenceManager(
      this.adapter,
      this.events,
      this.currentUserId,
      this.cfg.presenceIntervalMs
    );
    this.typingManager ??= new TypingManager(
      this.adapter,
      this.events,
      this.currentUserId,
      this.cfg.typingTimeoutMs
    );

    try {
      await this.adapter.connect(this.currentUserId);
      await this.presenceManager.start();
      this.connectionState = 'connected';
      this.reconnectAttempts = 0;
      this.reconnectScheduled = false;
      this.events.emit({ type: 'connection:connected' });

      if (this.cfg.offlineEnabled) void this.drainOfflineQueue();
    } catch (err) {
      this.connectionState = 'disconnected';
      this.events.emit({
        type: 'connection:disconnected',
        payload: { reason: err instanceof Error ? err.message : 'Unknown error' },
      });
      this.scheduleReconnect();
    }
  }

  async disconnect(): Promise<void> {
    await this.presenceManager?.stop();
    this.typingManager?.destroy();
    this.messageSubs.teardownAll();
    this.dedup.clear();
    this.reconnectScheduled = false;
    if (this.drainTimer) {
      clearTimeout(this.drainTimer);
      this.drainTimer = null;
    }
    try {
      await this.adapter.disconnect();
    } finally {
      this.connectionState = 'disconnected';
      this.events.emit({ type: 'connection:disconnected', payload: { reason: 'manual' } });
    }
  }

  /** Fully releases the engine: tears down subscriptions AND removes every listener. */
  async destroy(): Promise<void> {
    await this.disconnect();
    this.events.removeAllListeners();
  }

  // ─── Conversations ────────────────────────────────────────────────────────

  createConversation(input: CreateConversationInput): Promise<Conversation> {
    return this.adapter.createConversation(input);
  }

  getConversation(id: string): Promise<Conversation | null> {
    return this.adapter.getConversation(id);
  }

  listConversations(opts?: PaginationOptions): Promise<PaginatedResult<Conversation>> {
    return this.adapter.listConversations(this.userId, opts);
  }

  updateConversation(id: string, input: UpdateConversationInput): Promise<Conversation> {
    return this.adapter.updateConversation(id, input);
  }

  deleteConversation(id: string): Promise<void> {
    return this.adapter.deleteConversation(id);
  }

  subscribeConversations(
    callback: EventListener<'conversation:updated' | 'conversation:deleted'>
  ): UnsubscribeFn {
    return this.messageSubs.subscribe(
      `conversations:${this.userId}`,
      (event) => {
        if (event.type === 'conversation:updated' || event.type === 'conversation:deleted') {
          callback(event as never);
        }
      },
      (fanout) => this.adapter.subscribeConversations(this.userId, (event) => {
        this.events.emit(event);
        fanout(event);
      })
    );
  }

  // ─── Participants ──────────────────────────────────────────────────────────

  addParticipant(conversationId: string, input: AddParticipantInput): Promise<Participant> {
    return this.adapter.addParticipant(conversationId, input);
  }

  removeParticipant(conversationId: string, userId: string): Promise<void> {
    return this.adapter.removeParticipant(conversationId, userId);
  }

  listParticipants(conversationId: string): Promise<Participant[]> {
    return this.adapter.listParticipants(conversationId);
  }

  // ─── Messages ─────────────────────────────────────────────────────────────

  /**
   * Sends a message with an optimistic update. Flow:
   *  1. validate + sanitize, run `onBeforeSend` plugins (which may block).
   *  2. emit optimistic message (status: pending), tracking its client_id.
   *  3. if offline → enqueue and return optimistic.
   *  4. on server confirm → reconcile(client_id → server id), emit update,
   *     run `onAfterSend` plugins.
   */
  async sendMessage(input: Omit<SendMessageInput, 'client_id'>): Promise<AnyMessage> {
    const validated = validateMessageInput(input, this.cfg.validation);

    const hookResult = await this.plugins.runBeforeSend(validated, this.ctx);
    if (hookResult === false) {
      throw new Error('[Somni] Message blocked by plugin (onBeforeSend).');
    }
    const finalInput = hookResult;

    const client_id = generateId();
    // Track BEFORE emit so the realtime echo is recognised as a reconciliation,
    // never as a second "new" message (root-cause fix for optimistic duplicates).
    this.dedup.trackClientId(client_id);

    const optimistic: AnyMessage = {
      id: client_id,
      client_id,
      conversation_id: finalInput.conversation_id,
      sender_id: this.userId,
      type: finalInput.type ?? 'text',
      content: finalInput.content,
      status: 'pending',
      reply_to_id: finalInput.reply_to_id ?? null,
      reply_to_preview: null,
      created_at: new Date().toISOString(),
      delivered_at: null,
      read_at: null,
      edited_at: null,
      deleted_at: null,
      attachments: [],
      reactions: [],
      metadata: finalInput.metadata ?? {},
      _optimistic: true,
    };

    this.events.emit({ type: 'message:new', payload: optimistic });

    if (this.connectionState !== 'connected' && this.cfg.offlineEnabled) {
      this.offlineQueue.enqueue({ id: client_id, type: 'send_message', payload: { ...finalInput, client_id } });
      return optimistic;
    }

    try {
      const message = await this.adapter.sendMessage({ ...finalInput, client_id });
      this.dedup.reconcile(client_id, message.id);
      this.events.emit({ type: 'message:updated', payload: message });
      void this.plugins.runAfterSend(message, this.ctx);
      return message;
    } catch (err) {
      if (this.cfg.offlineEnabled) {
        this.offlineQueue.enqueue({ id: client_id, type: 'send_message', payload: { ...finalInput, client_id } });
        this.scheduleDrain();
      } else {
        // Surface the failure on the optimistic message so the UI can show retry.
        this.events.emit({ type: 'message:updated', payload: { ...optimistic, status: 'failed' } });
      }
      this.events.emit({
        type: 'error',
        payload: { code: 'SEND_FAILED', message: 'Message failed to send', context: err },
      });
      return optimistic;
    }
  }

  editMessage(input: EditMessageInput): Promise<Message> {
    return this.adapter.editMessage(input);
  }

  deleteMessage(messageId: string): Promise<void> {
    return this.adapter.deleteMessage(messageId);
  }

  listMessages(conversationId: string, opts?: MessageQueryOptions): Promise<PaginatedResult<Message>> {
    return this.adapter.listMessages(conversationId, { limit: this.cfg.messagePageSize, ...opts });
  }

  /**
   * Subscribe to realtime messages for a conversation. Multiple subscribers to
   * the same conversation share ONE adapter channel (fan-out), and incoming
   * messages are de-duplicated + reconciled before reaching any callback.
   */
  subscribeMessages(conversationId: string, callback: (event: ChatEvent) => void): UnsubscribeFn {
    return this.messageSubs.subscribe(
      `messages:${conversationId}`,
      callback,
      (fanout) =>
        this.adapter.subscribeMessages(conversationId, (event) => {
          void this.handleIncomingMessageEvent(event, fanout);
        })
    );
  }

  private async handleIncomingMessageEvent(
    event: ChatEvent,
    fanout: (event: ChatEvent) => void
  ): Promise<void> {
    if (event.type === 'message:new') {
      const msg = event.payload as Message;

      // Reconciliation: a server echo of our own optimistic message.
      if (this.dedup.hasClientId(msg.client_id)) {
        this.dedup.reconcile(msg.client_id, msg.id);
        const transformed = await this.plugins.runMessageReceive(msg, this.ctx);
        const updateEvent: ChatEvent = { type: 'message:updated', payload: transformed };
        this.events.emit(updateEvent);
        fanout(updateEvent);
        return;
      }

      // Hard duplicate (e.g. double delivery under load).
      if (this.dedup.isDuplicate(msg.id, msg.client_id)) return;

      this.dedup.trackServerId(msg.id);
      this.dedup.trackClientId(msg.client_id);

      const transformed = await this.plugins.runMessageReceive(msg, this.ctx);
      const newEvent: ChatEvent = { type: 'message:new', payload: transformed };
      this.events.emit(newEvent);
      fanout(newEvent);
      return;
    }

    this.events.emit(event);
    fanout(event);
  }

  /**
   * Unified, simplest-possible subscription: messages + typing for a
   * conversation in one call. Returns a single unsubscribe function.
   */
  subscribe(
    conversationId: string,
    handler: (event: ChatEvent) => void
  ): UnsubscribeFn {
    const unsubMessages = this.subscribeMessages(conversationId, handler);
    const unsubTyping = this.subscribeTyping(conversationId);
    const unsubTypingEvents = this.events.on('typing:updated', (event) => {
      if (event.payload.conversation_id === conversationId) handler(event);
    });
    return () => {
      unsubMessages();
      unsubTyping();
      unsubTypingEvents();
    };
  }

  // ─── Read Receipts ────────────────────────────────────────────────────────

  markAsRead(conversationId: string, messageId: string): Promise<void> {
    return this.adapter.markAsRead(conversationId, this.userId, messageId);
  }

  // ─── Reactions ────────────────────────────────────────────────────────────

  addReaction(messageId: string, emoji: string): Promise<Reaction> {
    return this.adapter.addReaction(messageId, this.userId, emoji);
  }

  removeReaction(messageId: string, emoji: string): Promise<void> {
    return this.adapter.removeReaction(messageId, this.userId, emoji);
  }

  // ─── Attachments ──────────────────────────────────────────────────────────

  uploadAttachment(input: UploadAttachmentInput): Promise<UploadAttachmentResult> {
    return this.adapter.uploadAttachment(input);
  }

  // ─── Presence ─────────────────────────────────────────────────────────────

  setPresenceStatus(status: PresenceStatus): Promise<void> {
    if (!this.presenceManager) return Promise.resolve();
    return this.presenceManager.setStatus(status);
  }

  fetchPresence(userIds: string[]): Promise<UserPresence[]> {
    if (!this.presenceManager) return Promise.resolve([]);
    return this.presenceManager.fetchPresence(userIds);
  }

  subscribePresence(userIds: string[]): UnsubscribeFn {
    if (!this.presenceManager) return () => undefined;
    const unsub = this.presenceManager.subscribeUsers(userIds);
    const unsubPlugin = this.events.on('presence:updated', (event) => {
      this.plugins.runPresenceChange(event.payload, this.ctx);
    });
    return () => {
      unsub();
      unsubPlugin();
    };
  }

  // ─── Typing ───────────────────────────────────────────────────────────────

  notifyTyping(conversationId: string): Promise<void> {
    if (!this.typingManager) return Promise.resolve();
    return this.typingManager.notifyTyping(conversationId);
  }

  stopTyping(conversationId: string): Promise<void> {
    if (!this.typingManager) return Promise.resolve();
    return this.typingManager.stopTyping(conversationId);
  }

  subscribeTyping(conversationId: string): UnsubscribeFn {
    if (!this.typingManager) return () => undefined;
    return this.typingManager.subscribeToConversation(conversationId);
  }

  getTypingUsers(conversationId: string): string[] {
    return this.typingManager?.getTypingUsers(conversationId) ?? [];
  }

  // ─── Offline diagnostics ────────────────────────────────────────────────────

  get pendingCount(): number {
    return this.offlineQueue.size();
  }

  getDeadLetterMessages(): ReadonlyArray<{ id: string; payload: SendMessageInput; last_error?: string }> {
    return this.offlineQueue.getDeadLetter();
  }

  retryDeadLetter(id: string): boolean {
    const ok = this.offlineQueue.retryDeadLetter(id);
    if (ok && this.connectionState === 'connected') void this.drainOfflineQueue();
    return ok;
  }

  // ─── Event API ────────────────────────────────────────────────────────────

  on<T extends ChatEventType>(type: T, listener: EventListener<T>): UnsubscribeFn {
    return this.events.on(type, listener);
  }

  // ─── Internal ─────────────────────────────────────────────────────────────

  /**
   * Drains the offline queue in strict FIFO order. A failed op stays at the
   * HEAD (order preserved) with an exponential-backoff gate, or is dead-lettered
   * after exceeding maxRetries — it never blocks the queue forever.
   */
  private async drainOfflineQueue(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      while (true) {
        const op = this.offlineQueue.peekReady();
        if (!op) break;
        try {
          const message = await this.adapter.sendMessage(op.payload);
          this.offlineQueue.ack(op.id);
          this.dedup.reconcile(op.payload.client_id, message.id);
          this.events.emit({ type: 'message:updated', payload: message });
          void this.plugins.runAfterSend(message, this.ctx);
        } catch (err) {
          const reason = err instanceof Error ? err.message : 'send failed';
          const deadLettered = this.offlineQueue.recordFailure(op.id, reason, (attempt) =>
            computeBackoff(attempt, this.cfg.reconnect)
          );
          if (deadLettered) {
            this.events.emit({
              type: 'error',
              payload: { code: 'MESSAGE_DEAD_LETTERED', message: 'Message permanently failed', context: op },
            });
            // continue draining remaining ops
          } else {
            // Head is backoff-gated; stop this pass and retry later.
            break;
          }
        }
      }
    } finally {
      this.draining = false;
      // If anything remains (backoff-gated), schedule the next attempt.
      if (!this.offlineQueue.isEmpty()) this.scheduleDrain();
    }
  }

  /** Schedules a single delayed drain aligned to the head op's backoff gate. */
  private scheduleDrain(): void {
    if (this.drainTimer) return;
    if (this.connectionState !== 'connected') return;
    const wait = this.offlineQueue.msUntilReady();
    if (wait === null) return;
    this.drainTimer = setTimeout(() => {
      this.drainTimer = null;
      void this.drainOfflineQueue();
    }, wait);
    if (this.drainTimer && typeof (this.drainTimer as { unref?: () => void }).unref === 'function') {
      (this.drainTimer as { unref: () => void }).unref();
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectScheduled) return; // single-flight: no reconnect storms
    if (this.reconnectAttempts >= this.cfg.reconnect.maxAttempts) return;

    this.reconnectScheduled = true;
    this.reconnectAttempts += 1;
    this.connectionState = 'reconnecting';
    const delay = computeBackoff(this.reconnectAttempts, this.cfg.reconnect);

    this.events.emit({ type: 'connection:reconnecting', payload: { attempt: this.reconnectAttempts } });

    setTimeout(() => {
      this.reconnectScheduled = false;
      void this.connect();
    }, delay);
  }
}

/**
 * Factory — the public entry point.
 *
 * @example
 * const chat = createChat({ adapter });
 * await chat.connect(userId);
 */
export function createChat(config: ChatEngineConfig): ChatEngine {
  return new ChatEngine(config);
}

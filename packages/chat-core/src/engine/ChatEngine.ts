import type { ChatAdapter, PaginationOptions, MessageQueryOptions, PaginatedResult } from '../adapter/ChatAdapter';
import type { ChatEngineConfig } from '../types/config';
import type { Conversation, CreateConversationInput, UpdateConversationInput } from '../types/conversation';
import type { Participant, AddParticipantInput } from '../types/participant';
import type { Message, SendMessageInput, EditMessageInput, Reaction, AnyMessage } from '../types/message';
import type { UserPresence, PresenceStatus } from '../types/presence';
import type { ChatEventType, EventListener, ChatEvent } from '../types/events';

import { ChatEventEmitter } from './EventEmitter';
import { PresenceManager } from './PresenceManager';
import { TypingManager } from './TypingManager';
import { DeduplicationCache } from '../utils/deduplication';
import { OfflineQueue } from '../utils/offlineQueue';
import { generateId } from '../utils/uuid';

type ConnectionState = 'idle' | 'connecting' | 'connected' | 'disconnected' | 'reconnecting';

export class ChatEngine {
  readonly events: ChatEventEmitter;
  private connectionState: ConnectionState = 'idle';
  private readonly dedup: DeduplicationCache;
  private readonly offlineQueue: OfflineQueue;
  private readonly presenceManager: PresenceManager;
  private readonly typingManager: TypingManager;
  private readonly subscriptions = new Map<string, () => void>();
  private reconnectAttempts = 0;

  private readonly config: Required<Pick<ChatEngineConfig, 'typingTimeoutMs' | 'presenceIntervalMs' | 'offlineQueue' | 'messagePageSize'>> & ChatEngineConfig;

  constructor(private readonly rawConfig: ChatEngineConfig) {
    this.config = {
      typingTimeoutMs: 3000,
      presenceIntervalMs: 30_000,
      offlineQueue: true,
      messagePageSize: 50,
      reconnect: { maxAttempts: 10, baseDelayMs: 1000, maxDelayMs: 30_000 },
      plugins: [],
      ...rawConfig,
    };

    this.events = new ChatEventEmitter();
    this.dedup = new DeduplicationCache();
    this.offlineQueue = new OfflineQueue();

    this.presenceManager = new PresenceManager(
      this.adapter,
      this.events,
      this.config.userId,
      this.config.presenceIntervalMs
    );

    this.typingManager = new TypingManager(
      this.adapter,
      this.events,
      this.config.userId,
      this.config.typingTimeoutMs
    );
  }

  private get adapter(): ChatAdapter {
    return this.config.adapter;
  }

  get userId(): string {
    return this.config.userId;
  }

  get state(): ConnectionState {
    return this.connectionState;
  }

  // ─── Lifecycle ────────────────────────────────────────────────────────────

  async connect(): Promise<void> {
    if (this.connectionState === 'connected') return;
    this.connectionState = 'connecting';

    try {
      await this.adapter.connect(this.config.userId);
      await this.presenceManager.start();
      this.connectionState = 'connected';
      this.reconnectAttempts = 0;
      this.events.emit({ type: 'connection:connected' });

      // Drain offline queue
      if (this.config.offlineQueue) {
        void this.drainOfflineQueue();
      }
    } catch (err) {
      this.connectionState = 'disconnected';
      this.events.emit({
        type: 'connection:disconnected',
        payload: { reason: err instanceof Error ? err.message : 'Unknown error' },
      });
      void this.scheduleReconnect();
    }
  }

  async disconnect(): Promise<void> {
    await this.presenceManager.stop();
    this.typingManager.destroy();
    for (const [, unsub] of this.subscriptions) unsub();
    this.subscriptions.clear();
    await this.adapter.disconnect();
    this.connectionState = 'disconnected';
    this.events.emit({ type: 'connection:disconnected', payload: { reason: 'manual' } });
  }

  // ─── Conversations ────────────────────────────────────────────────────────

  async createConversation(input: CreateConversationInput): Promise<Conversation> {
    return this.adapter.createConversation(input);
  }

  async getConversation(id: string): Promise<Conversation | null> {
    return this.adapter.getConversation(id);
  }

  async listConversations(opts?: PaginationOptions): Promise<PaginatedResult<Conversation>> {
    return this.adapter.listConversations(this.config.userId, opts);
  }

  async updateConversation(id: string, input: UpdateConversationInput): Promise<Conversation> {
    return this.adapter.updateConversation(id, input);
  }

  subscribeConversations(callback: EventListener<'conversation:updated' | 'conversation:deleted'>): () => void {
    return this.adapter.subscribeConversations(this.config.userId, (event) => {
      if (event.type === 'conversation:updated' || event.type === 'conversation:deleted') {
        callback(event as never);
      }
      this.events.emit(event);
    });
  }

  // ─── Participants ──────────────────────────────────────────────────────────

  async addParticipant(conversationId: string, input: AddParticipantInput): Promise<Participant> {
    return this.adapter.addParticipant(conversationId, input);
  }

  async removeParticipant(conversationId: string, userId: string): Promise<void> {
    return this.adapter.removeParticipant(conversationId, userId);
  }

  async listParticipants(conversationId: string): Promise<Participant[]> {
    return this.adapter.listParticipants(conversationId);
  }

  // ─── Messages ─────────────────────────────────────────────────────────────

  async sendMessage(input: Omit<SendMessageInput, 'client_id'>): Promise<AnyMessage> {
    const client_id = generateId();

    // Optimistic update — emit immediately, before server confirmation
    const optimistic: AnyMessage = {
      id: client_id,
      client_id,
      conversation_id: input.conversation_id,
      sender_id: this.config.userId,
      type: input.type ?? 'text',
      content: input.content,
      status: 'pending',
      reply_to_id: input.reply_to_id ?? null,
      reply_to_preview: null,
      created_at: new Date().toISOString(),
      delivered_at: null,
      read_at: null,
      edited_at: null,
      deleted_at: null,
      attachments: [],
      reactions: [],
      metadata: input.metadata ?? {},
      _optimistic: true,
    };

    this.events.emit({ type: 'message:new', payload: optimistic });

    if (this.connectionState !== 'connected' && this.config.offlineQueue) {
      this.offlineQueue.enqueue({ id: client_id, type: 'send_message', payload: { ...input, client_id } });
      return optimistic;
    }

    try {
      const message = await this.adapter.sendMessage({ ...input, client_id });
      // Replace optimistic with confirmed
      this.events.emit({ type: 'message:updated', payload: message });
      return message;
    } catch (err) {
      if (this.config.offlineQueue) {
        this.offlineQueue.enqueue({ id: client_id, type: 'send_message', payload: { ...input, client_id } });
      }
      this.events.emit({
        type: 'error',
        payload: { code: 'SEND_FAILED', message: 'Message failed to send', context: err },
      });
      return optimistic;
    }
  }

  async editMessage(input: EditMessageInput): Promise<Message> {
    return this.adapter.editMessage(input);
  }

  async deleteMessage(messageId: string): Promise<void> {
    return this.adapter.deleteMessage(messageId);
  }

  async listMessages(conversationId: string, opts?: MessageQueryOptions): Promise<PaginatedResult<Message>> {
    return this.adapter.listMessages(conversationId, opts);
  }

  subscribeMessages(
    conversationId: string,
    callback: (event: ChatEvent) => void
  ): () => void {
    const key = `messages:${conversationId}`;
    if (this.subscriptions.has(key)) return this.subscriptions.get(key)!;

    const unsub = this.adapter.subscribeMessages(conversationId, (event) => {
      // Deduplicate incoming messages
      if (event.type === 'message:new') {
        const msg = event.payload as Message;
        if (this.dedup.hasClientId(msg.client_id)) {
          // Server confirmed an optimistic message — emit update instead
          this.events.emit({ type: 'message:updated', payload: msg });
          callback({ type: 'message:updated', payload: msg });
          return;
        }
        if (this.dedup.hasServerId(msg.id)) return;
        this.dedup.trackServerId(msg.id);
        this.dedup.trackClientId(msg.client_id);
      }

      this.events.emit(event);
      callback(event);
    });

    this.subscriptions.set(key, unsub);
    return unsub;
  }

  // ─── Read Receipts ────────────────────────────────────────────────────────

  async markAsRead(conversationId: string, messageId: string): Promise<void> {
    return this.adapter.markAsRead(conversationId, this.config.userId, messageId);
  }

  // ─── Reactions ────────────────────────────────────────────────────────────

  async addReaction(messageId: string, emoji: string): Promise<Reaction> {
    return this.adapter.addReaction(messageId, this.config.userId, emoji);
  }

  async removeReaction(messageId: string, emoji: string): Promise<void> {
    return this.adapter.removeReaction(messageId, this.config.userId, emoji);
  }

  // ─── Presence ─────────────────────────────────────────────────────────────

  async setPresenceStatus(status: PresenceStatus): Promise<void> {
    return this.presenceManager.setStatus(status);
  }

  async fetchPresence(userIds: string[]): Promise<UserPresence[]> {
    return this.presenceManager.fetchPresence(userIds);
  }

  subscribePresence(userIds: string[]): () => void {
    return this.presenceManager.subscribeUsers(userIds);
  }

  // ─── Typing ───────────────────────────────────────────────────────────────

  async notifyTyping(conversationId: string): Promise<void> {
    return this.typingManager.notifyTyping(conversationId);
  }

  async stopTyping(conversationId: string): Promise<void> {
    return this.typingManager.stopTyping(conversationId);
  }

  subscribeTyping(conversationId: string): () => void {
    return this.typingManager.subscribeToConversation(conversationId);
  }

  getTypingUsers(conversationId: string): string[] {
    return this.typingManager.getTypingUsers(conversationId);
  }

  // ─── Event API ────────────────────────────────────────────────────────────

  on<T extends ChatEventType>(type: T, listener: EventListener<T>): () => void {
    return this.events.on(type, listener);
  }

  // ─── Internal ─────────────────────────────────────────────────────────────

  private async drainOfflineQueue(): Promise<void> {
    while (!this.offlineQueue.isEmpty()) {
      const op = this.offlineQueue.dequeue();
      if (!op) break;
      try {
        if (op.type === 'send_message') {
          const message = await this.adapter.sendMessage(op.payload);
          this.events.emit({ type: 'message:updated', payload: message });
        }
      } catch {
        this.offlineQueue.enqueue(op);
        break;
      }
    }
  }

  private async scheduleReconnect(): Promise<void> {
    const { maxAttempts, baseDelayMs, maxDelayMs } = this.config.reconnect ?? { maxAttempts: 10, baseDelayMs: 1000, maxDelayMs: 30_000 };

    if (this.reconnectAttempts >= maxAttempts) return;

    this.reconnectAttempts++;
    this.connectionState = 'reconnecting';
    const delay = Math.min(baseDelayMs * 2 ** (this.reconnectAttempts - 1), maxDelayMs);

    this.events.emit({ type: 'connection:reconnecting', payload: { attempt: this.reconnectAttempts } });

    await new Promise((r) => setTimeout(r, delay));
    void this.connect();
  }
}

/** Factory function — the public entry point */
export function createChat(config: ChatEngineConfig): ChatEngine {
  return new ChatEngine(config);
}

import type {
  ChatAdapter,
  PaginationOptions,
  MessageQueryOptions,
  PaginatedResult,
  UnsubscribeFn,
  UploadAttachmentInput,
  UploadAttachmentResult,
  Conversation,
  CreateConversationInput,
  UpdateConversationInput,
  Participant,
  AddParticipantInput,
  Message,
  SendMessageInput,
  EditMessageInput,
  Reaction,
  UserPresence,
  PresenceUpdate,
  TypingUpdate,
  ChatEvent,
} from '../../src/index.ts';

type Listener = (event: ChatEvent) => void;

/**
 * In-memory adapter for tests. Simulates a realtime backend:
 *  - sendMessage persists + (optionally) echoes a `message:new` to subscribers
 *    on the next tick, exactly like a Postgres/Firestore change feed.
 *  - `online` toggle makes sendMessage throw, to exercise the offline queue.
 */
export class MockAdapter implements ChatAdapter {
  online = true;
  /** When true, every persisted message is echoed to subscribers (realtime). */
  echo = true;
  /** Artificial delay (ms) before sendMessage resolves. */
  sendLatency = 0;

  messages: Message[] = [];
  private messageListeners = new Map<string, Set<Listener>>();
  private typingListeners = new Map<string, Set<Listener>>();
  private presenceListeners = new Set<Listener>();
  private seq = 0;

  sendCalls = 0;
  uploadCalls = 0;

  async connect(): Promise<void> {}
  async disconnect(): Promise<void> {
    this.messageListeners.clear();
    this.typingListeners.clear();
    this.presenceListeners.clear();
  }

  async createConversation(input: CreateConversationInput): Promise<Conversation> {
    const now = new Date().toISOString();
    return {
      id: `conv_${++this.seq}`,
      type: input.type,
      title: input.title ?? null,
      description: null,
      avatar_url: null,
      status: 'active',
      metadata: {},
      created_at: now,
      updated_at: now,
      last_message_at: null,
      last_message_preview: null,
      created_by: input.participant_ids[0] ?? '',
    };
  }
  async getConversation(): Promise<Conversation | null> { return null; }
  async listConversations(): Promise<PaginatedResult<Conversation>> {
    return { items: [], has_more: false, next_cursor: null };
  }
  async updateConversation(id: string, input: UpdateConversationInput): Promise<Conversation> {
    const now = new Date().toISOString();
    return {
      id, type: 'group', title: input.title ?? null, description: null, avatar_url: null,
      status: 'active', metadata: {}, created_at: now, updated_at: now,
      last_message_at: null, last_message_preview: null, created_by: '',
    };
  }
  async deleteConversation(): Promise<void> {}
  subscribeConversations(): UnsubscribeFn { return () => undefined; }

  async addParticipant(conversationId: string, input: AddParticipantInput): Promise<Participant> {
    return {
      conversation_id: conversationId, user_id: input.user_id, role: input.role ?? 'member',
      status: 'active', joined_at: new Date().toISOString(), last_read_at: null,
      last_read_message_id: null, notifications_muted: false, metadata: {},
    };
  }
  async removeParticipant(): Promise<void> {}
  async listParticipants(): Promise<Participant[]> { return []; }
  async updateParticipantRole(conversationId: string, userId: string, role: Participant['role']): Promise<Participant> {
    return {
      conversation_id: conversationId, user_id: userId, role, status: 'active',
      joined_at: new Date().toISOString(), last_read_at: null, last_read_message_id: null,
      notifications_muted: false, metadata: {},
    };
  }

  async sendMessage(input: SendMessageInput): Promise<Message> {
    this.sendCalls++;
    if (this.sendLatency) await new Promise((r) => setTimeout(r, this.sendLatency));
    if (!this.online) throw new Error('offline');

    const msg = this.buildMessage(input);
    this.messages.push(msg);

    if (this.echo) {
      // Emit on next tick like a real change feed.
      queueMicrotask(() => this.emitMessage(input.conversation_id, { type: 'message:new', payload: msg }));
    }
    return msg;
  }

  /** Simulate a message arriving from ANOTHER user (no optimistic origin). */
  injectIncoming(conversationId: string, content: string, senderId = 'other'): Message {
    const msg = this.buildMessage({
      conversation_id: conversationId,
      content,
      client_id: `srv_${++this.seq}`,
    });
    msg.sender_id = senderId;
    this.messages.push(msg);
    this.emitMessage(conversationId, { type: 'message:new', payload: msg });
    return msg;
  }

  /** Force a duplicate delivery of an existing server message. */
  redeliver(conversationId: string, msg: Message): void {
    this.emitMessage(conversationId, { type: 'message:new', payload: msg });
  }

  private buildMessage(input: SendMessageInput): Message {
    const now = new Date(Date.now() + this.seq).toISOString();
    return {
      id: `srv_${++this.seq}`,
      conversation_id: input.conversation_id,
      sender_id: 'me',
      type: input.type ?? 'text',
      content: input.content,
      status: 'sent',
      client_id: input.client_id,
      reply_to_id: input.reply_to_id ?? null,
      reply_to_preview: null,
      created_at: now,
      delivered_at: now,
      read_at: null,
      edited_at: null,
      deleted_at: null,
      attachments: [],
      reactions: [],
      metadata: input.metadata ?? {},
    };
  }

  async editMessage(input: EditMessageInput): Promise<Message> {
    const msg = this.messages.find((m) => m.id === input.message_id)!;
    msg.content = input.content;
    msg.edited_at = new Date().toISOString();
    return msg;
  }
  async deleteMessage(messageId: string): Promise<void> {
    const msg = this.messages.find((m) => m.id === messageId);
    if (msg) msg.deleted_at = new Date().toISOString();
  }
  async getMessage(messageId: string): Promise<Message | null> {
    return this.messages.find((m) => m.id === messageId) ?? null;
  }
  async listMessages(conversationId: string): Promise<PaginatedResult<Message>> {
    return {
      items: this.messages.filter((m) => m.conversation_id === conversationId),
      has_more: false,
      next_cursor: null,
    };
  }
  subscribeMessages(conversationId: string, callback: Listener): UnsubscribeFn {
    if (!this.messageListeners.has(conversationId)) this.messageListeners.set(conversationId, new Set());
    const set = this.messageListeners.get(conversationId)!;
    set.add(callback);
    return () => set.delete(callback);
  }
  private emitMessage(conversationId: string, event: ChatEvent): void {
    this.messageListeners.get(conversationId)?.forEach((cb) => cb(event));
  }

  async markAsRead(): Promise<void> {}

  async addReaction(messageId: string, userId: string, emoji: string): Promise<Reaction> {
    return { message_id: messageId, user_id: userId, emoji, created_at: new Date().toISOString() };
  }
  async removeReaction(): Promise<void> {}

  async uploadAttachment(input: UploadAttachmentInput): Promise<UploadAttachmentResult> {
    this.uploadCalls++;
    return {
      file_url: `mock://files/${input.file_name}`,
      file_name: input.file_name,
      file_type: 'document',
      mime_type: input.mime_type,
      file_size: 123,
    };
  }

  async updatePresence(_update: PresenceUpdate): Promise<void> {}
  async getPresence(userIds: string[]): Promise<UserPresence[]> {
    return userIds.map((user_id) => ({
      user_id, status: 'online', last_seen_at: new Date().toISOString(), device: null, metadata: {},
    }));
  }
  subscribePresence(_userIds: string[], callback: Listener): UnsubscribeFn {
    this.presenceListeners.add(callback);
    return () => this.presenceListeners.delete(callback);
  }

  async updateTyping(_update: TypingUpdate): Promise<void> {}
  subscribeTyping(conversationId: string, callback: Listener): UnsubscribeFn {
    if (!this.typingListeners.has(conversationId)) this.typingListeners.set(conversationId, new Set());
    const set = this.typingListeners.get(conversationId)!;
    set.add(callback);
    return () => set.delete(callback);
  }
  emitTyping(conversationId: string, userId: string, isTyping: boolean): void {
    this.typingListeners.get(conversationId)?.forEach((cb) =>
      cb({
        type: 'typing:updated',
        payload: { conversation_id: conversationId, user_id: userId, is_typing: isTyping, started_at: new Date().toISOString() },
      })
    );
  }
}

export const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

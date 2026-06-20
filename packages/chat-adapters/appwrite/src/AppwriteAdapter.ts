import type { Client, Databases, Realtime } from 'appwrite';
import { ID, Query, Permission, Role } from 'appwrite';
import type {
  ChatAdapter,
  PaginationOptions,
  MessageQueryOptions,
  PaginatedResult,
  UnsubscribeFn,
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
} from '@somni/chat-core';

export interface AppwriteAdapterConfig {
  client: Client;
  databases: Databases;
  realtime: Realtime;
  databaseId: string;
  collections: {
    conversations: string;
    participants: string;
    messages: string;
    attachments: string;
    reactions: string;
    presence: string;
  };
}

/**
 * Appwrite implementation of the ChatAdapter interface.
 * Uses Appwrite Databases for storage and Realtime for live subscriptions.
 */
export class AppwriteAdapter implements ChatAdapter {
  private readonly db: Databases;
  private readonly realtime: Realtime;
  private readonly databaseId: string;
  private readonly col: AppwriteAdapterConfig['collections'];
  private readonly unsubscribers: Array<() => void> = [];

  constructor(private readonly config: AppwriteAdapterConfig) {
    this.db = config.databases;
    this.realtime = config.realtime;
    this.databaseId = config.databaseId;
    this.col = config.collections;
  }

  private typingChannels = new Map<string, ReturnType<typeof setTimeout>>();

  // ─── Lifecycle ────────────────────────────────────────────────────────────

  async connect(_userId: string): Promise<void> {
    // Appwrite connection is managed by the client SDK
  }

  async disconnect(): Promise<void> {
    for (const unsub of this.unsubscribers) unsub();
    this.unsubscribers.length = 0;
  }

  // ─── Conversations ────────────────────────────────────────────────────────

  async createConversation(input: CreateConversationInput): Promise<Conversation> {
    const doc = await this.db.createDocument(
      this.databaseId,
      this.col.conversations,
      ID.unique(),
      {
        type: input.type,
        title: input.title ?? null,
        description: input.description ?? null,
        avatar_url: input.avatar_url ?? null,
        status: 'active',
        metadata: JSON.stringify(input.metadata ?? {}),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        last_message_at: null,
        last_message_preview: null,
        created_by: input.participant_ids[0] ?? '',
      },
      input.participant_ids.map((uid) => [
        Permission.read(Role.user(uid)),
        Permission.write(Role.user(uid)),
      ]).flat()
    );

    // Add participants
    await Promise.all(
      input.participant_ids.map((uid, i) =>
        this.db.createDocument(this.databaseId, this.col.participants, ID.unique(), {
          conversation_id: doc.$id,
          user_id: uid,
          role: i === 0 ? 'owner' : 'member',
          status: 'active',
          joined_at: new Date().toISOString(),
          notifications_muted: false,
          metadata: '{}',
        })
      )
    );

    return this.mapConversation(doc);
  }

  async getConversation(id: string): Promise<Conversation | null> {
    try {
      const doc = await this.db.getDocument(this.databaseId, this.col.conversations, id);
      return this.mapConversation(doc);
    } catch {
      return null;
    }
  }

  async listConversations(userId: string, opts?: PaginationOptions): Promise<PaginatedResult<Conversation>> {
    const limit = opts?.limit ?? 30;

    const participants = await this.db.listDocuments(
      this.databaseId,
      this.col.participants,
      [
        Query.equal('user_id', userId),
        Query.equal('status', 'active'),
        Query.limit(limit),
      ]
    );

    const conversationIds = participants.documents.map((p) => p['conversation_id'] as string);
    if (!conversationIds.length) return { items: [], has_more: false, next_cursor: null };

    const conversations = await this.db.listDocuments(
      this.databaseId,
      this.col.conversations,
      [
        Query.equal('$id', conversationIds),
        Query.orderDesc('last_message_at'),
        Query.limit(limit),
      ]
    );

    const items = conversations.documents.map((d) => this.mapConversation(d));
    return {
      items,
      has_more: items.length === limit,
      next_cursor: items[items.length - 1]?.last_message_at ?? null,
    };
  }

  async updateConversation(id: string, input: UpdateConversationInput): Promise<Conversation> {
    const doc = await this.db.updateDocument(this.databaseId, this.col.conversations, id, {
      ...input,
      updated_at: new Date().toISOString(),
    });
    return this.mapConversation(doc);
  }

  async deleteConversation(id: string): Promise<void> {
    await this.db.updateDocument(this.databaseId, this.col.conversations, id, { status: 'deleted' });
  }

  subscribeConversations(userId: string, callback: (event: ChatEvent) => void): UnsubscribeFn {
    const unsub = this.realtime.subscribe(
      `databases.${this.databaseId}.collections.${this.col.conversations}.documents`,
      (response) => {
        if (response.events.some((e) => e.includes('update'))) {
          callback({ type: 'conversation:updated', payload: this.mapConversation(response.payload as Record<string, unknown>) });
        } else if (response.events.some((e) => e.includes('delete'))) {
          callback({ type: 'conversation:deleted', payload: { id: (response.payload as { $id: string }).$id } });
        }
      }
    );
    this.unsubscribers.push(unsub);
    return unsub;
  }

  // ─── Participants ──────────────────────────────────────────────────────────

  async addParticipant(conversationId: string, input: AddParticipantInput): Promise<Participant> {
    const doc = await this.db.createDocument(
      this.databaseId,
      this.col.participants,
      ID.unique(),
      {
        conversation_id: conversationId,
        user_id: input.user_id,
        role: input.role ?? 'member',
        status: 'active',
        joined_at: new Date().toISOString(),
        notifications_muted: false,
        metadata: '{}',
      }
    );
    return this.mapParticipant(doc);
  }

  async removeParticipant(conversationId: string, userId: string): Promise<void> {
    const docs = await this.db.listDocuments(this.databaseId, this.col.participants, [
      Query.equal('conversation_id', conversationId),
      Query.equal('user_id', userId),
    ]);
    for (const doc of docs.documents) {
      await this.db.updateDocument(this.databaseId, this.col.participants, doc.$id, { status: 'left' });
    }
  }

  async listParticipants(conversationId: string): Promise<Participant[]> {
    const docs = await this.db.listDocuments(this.databaseId, this.col.participants, [
      Query.equal('conversation_id', conversationId),
      Query.equal('status', 'active'),
    ]);
    return docs.documents.map((d) => this.mapParticipant(d));
  }

  async updateParticipantRole(conversationId: string, userId: string, role: Participant['role']): Promise<Participant> {
    const docs = await this.db.listDocuments(this.databaseId, this.col.participants, [
      Query.equal('conversation_id', conversationId),
      Query.equal('user_id', userId),
    ]);
    if (!docs.documents.length) throw new Error('Participant not found');
    const doc = await this.db.updateDocument(this.databaseId, this.col.participants, docs.documents[0]!.$id, { role });
    return this.mapParticipant(doc);
  }

  // ─── Messages ─────────────────────────────────────────────────────────────

  async sendMessage(input: SendMessageInput): Promise<Message> {
    const doc = await this.db.createDocument(
      this.databaseId,
      this.col.messages,
      ID.unique(),
      {
        conversation_id: input.conversation_id,
        content: input.content,
        type: input.type ?? 'text',
        reply_to_id: input.reply_to_id ?? null,
        client_id: input.client_id ?? ID.unique(),
        status: 'sent',
        created_at: new Date().toISOString(),
        metadata: JSON.stringify(input.metadata ?? {}),
      }
    );

    // Update conversation last_message_at
    await this.db.updateDocument(this.databaseId, this.col.conversations, input.conversation_id, {
      last_message_at: doc['created_at'],
      last_message_preview: (input.content as string).slice(0, 100),
    });

    if (input.attachments?.length) {
      await Promise.all(
        input.attachments.map((a) =>
          this.db.createDocument(this.databaseId, this.col.attachments, ID.unique(), {
            message_id: doc.$id,
            ...a,
          })
        )
      );
    }

    return this.mapMessage(doc);
  }

  async editMessage(input: EditMessageInput): Promise<Message> {
    const doc = await this.db.updateDocument(this.databaseId, this.col.messages, input.message_id, {
      content: input.content,
      edited_at: new Date().toISOString(),
    });
    return this.mapMessage(doc);
  }

  async deleteMessage(messageId: string): Promise<void> {
    await this.db.updateDocument(this.databaseId, this.col.messages, messageId, {
      deleted_at: new Date().toISOString(),
    });
  }

  async getMessage(messageId: string): Promise<Message | null> {
    try {
      const doc = await this.db.getDocument(this.databaseId, this.col.messages, messageId);
      return this.mapMessage(doc);
    } catch {
      return null;
    }
  }

  async listMessages(conversationId: string, opts?: MessageQueryOptions): Promise<PaginatedResult<Message>> {
    const limit = opts?.limit ?? 50;
    const queries: string[] = [
      Query.equal('conversation_id', conversationId),
      Query.orderDesc('created_at'),
      Query.limit(limit),
    ];
    if (!opts?.include_deleted) queries.push(Query.isNull('deleted_at'));
    if (opts?.cursor) queries.push(Query.lessThan('created_at', opts.cursor));

    const docs = await this.db.listDocuments(this.databaseId, this.col.messages, queries);
    const items = docs.documents.map((d) => this.mapMessage(d)).reverse();

    return {
      items,
      has_more: items.length === limit,
      next_cursor: items[0]?.created_at ?? null,
    };
  }

  subscribeMessages(conversationId: string, callback: (event: ChatEvent) => void): UnsubscribeFn {
    const unsub = this.realtime.subscribe(
      `databases.${this.databaseId}.collections.${this.col.messages}.documents`,
      (response) => {
        const payload = response.payload as Record<string, unknown>;
        if (payload['conversation_id'] !== conversationId) return;

        if (response.events.some((e) => e.includes('create'))) {
          callback({ type: 'message:new', payload: this.mapMessage(payload) });
        } else if (response.events.some((e) => e.includes('update'))) {
          callback({ type: 'message:updated', payload: this.mapMessage(payload) });
        }
      }
    );
    this.unsubscribers.push(unsub);
    return unsub;
  }

  // ─── Read Receipts ────────────────────────────────────────────────────────

  async markAsRead(conversationId: string, userId: string, messageId: string): Promise<void> {
    const docs = await this.db.listDocuments(this.databaseId, this.col.participants, [
      Query.equal('conversation_id', conversationId),
      Query.equal('user_id', userId),
    ]);
    if (docs.documents.length) {
      await this.db.updateDocument(this.databaseId, this.col.participants, docs.documents[0]!.$id, {
        last_read_message_id: messageId,
        last_read_at: new Date().toISOString(),
      });
    }
  }

  // ─── Reactions ────────────────────────────────────────────────────────────

  async addReaction(messageId: string, userId: string, emoji: string): Promise<Reaction> {
    try {
      const doc = await this.db.createDocument(this.databaseId, this.col.reactions, ID.unique(), {
        message_id: messageId,
        user_id: userId,
        emoji,
        created_at: new Date().toISOString(),
      });
      return doc as unknown as Reaction;
    } catch {
      // Already exists — return existing
      const docs = await this.db.listDocuments(this.databaseId, this.col.reactions, [
        Query.equal('message_id', messageId),
        Query.equal('user_id', userId),
        Query.equal('emoji', emoji),
      ]);
      return docs.documents[0] as unknown as Reaction;
    }
  }

  async removeReaction(messageId: string, userId: string, emoji: string): Promise<void> {
    const docs = await this.db.listDocuments(this.databaseId, this.col.reactions, [
      Query.equal('message_id', messageId),
      Query.equal('user_id', userId),
      Query.equal('emoji', emoji),
    ]);
    for (const doc of docs.documents) {
      await this.db.deleteDocument(this.databaseId, this.col.reactions, doc.$id);
    }
  }

  // ─── Presence ─────────────────────────────────────────────────────────────

  async updatePresence(update: PresenceUpdate): Promise<void> {
    try {
      await this.db.createDocument(this.databaseId, 'presence', update.user_id, {
        status: update.status,
        last_seen_at: new Date().toISOString(),
        device: update.device ?? null,
        metadata: '{}',
      });
    } catch {
      await this.db.updateDocument(this.databaseId, 'presence', update.user_id, {
        status: update.status,
        last_seen_at: new Date().toISOString(),
      });
    }
  }

  async getPresence(userIds: string[]): Promise<UserPresence[]> {
    const docs = await this.db.listDocuments(this.databaseId, 'presence', [
      Query.equal('$id', userIds),
    ]);
    return docs.documents as unknown as UserPresence[];
  }

  subscribePresence(userIds: string[], callback: (event: ChatEvent) => void): UnsubscribeFn {
    const unsub = this.realtime.subscribe(
      userIds.map((id) => `databases.${this.databaseId}.collections.presence.documents.${id}`),
      (response) => {
        callback({ type: 'presence:updated', payload: response.payload as UserPresence });
      }
    );
    this.unsubscribers.push(unsub);
    return unsub;
  }

  // ─── Typing ───────────────────────────────────────────────────────────────

  async updateTyping(update: TypingUpdate): Promise<void> {
    // Appwrite doesn't have native broadcast — use a ephemeral document approach
    const docId = `typing_${update.conversation_id}_${update.user_id}`;
    try {
      if (update.is_typing) {
        await this.db.createDocument(this.databaseId, 'typing_indicators', docId, {
          conversation_id: update.conversation_id,
          user_id: update.user_id,
          started_at: new Date().toISOString(),
        });
      } else {
        await this.db.deleteDocument(this.databaseId, 'typing_indicators', docId);
      }
    } catch {
      // Document may already exist or not exist — both are acceptable
    }
  }

  subscribeTyping(conversationId: string, callback: (event: ChatEvent) => void): UnsubscribeFn {
    const unsub = this.realtime.subscribe(
      `databases.${this.databaseId}.collections.typing_indicators.documents`,
      (response) => {
        const payload = response.payload as Record<string, unknown>;
        if (payload['conversation_id'] !== conversationId) return;

        const is_typing = response.events.some((e) => e.includes('create'));
        callback({
          type: 'typing:updated',
          payload: {
            conversation_id: conversationId,
            user_id: payload['user_id'] as string,
            is_typing,
            started_at: (payload['started_at'] as string) ?? new Date().toISOString(),
          },
        });
      }
    );
    this.unsubscribers.push(unsub);
    return unsub;
  }

  // ─── Mappers ──────────────────────────────────────────────────────────────

  private mapConversation(doc: Record<string, unknown>): Conversation {
    return {
      id: (doc['$id'] ?? doc['id']) as string,
      type: doc['type'] as Conversation['type'],
      title: (doc['title'] as string) ?? null,
      description: (doc['description'] as string) ?? null,
      avatar_url: (doc['avatar_url'] as string) ?? null,
      status: (doc['status'] as Conversation['status']) ?? 'active',
      metadata: typeof doc['metadata'] === 'string' ? JSON.parse(doc['metadata'] as string) : (doc['metadata'] as Record<string, unknown>) ?? {},
      created_at: doc['created_at'] as string,
      updated_at: doc['updated_at'] as string,
      last_message_at: (doc['last_message_at'] as string) ?? null,
      last_message_preview: (doc['last_message_preview'] as string) ?? null,
      created_by: doc['created_by'] as string,
    };
  }

  private mapParticipant(doc: Record<string, unknown>): Participant {
    return {
      conversation_id: doc['conversation_id'] as string,
      user_id: doc['user_id'] as string,
      role: doc['role'] as Participant['role'],
      status: doc['status'] as Participant['status'],
      joined_at: doc['joined_at'] as string,
      last_read_at: (doc['last_read_at'] as string) ?? null,
      last_read_message_id: (doc['last_read_message_id'] as string) ?? null,
      notifications_muted: (doc['notifications_muted'] as boolean) ?? false,
      metadata: typeof doc['metadata'] === 'string' ? JSON.parse(doc['metadata'] as string) : {},
    };
  }

  private mapMessage(doc: Record<string, unknown>): Message {
    return {
      id: (doc['$id'] ?? doc['id']) as string,
      conversation_id: doc['conversation_id'] as string,
      sender_id: doc['sender_id'] as string,
      type: (doc['type'] as Message['type']) ?? 'text',
      content: doc['content'] as string,
      status: (doc['status'] as Message['status']) ?? 'sent',
      client_id: doc['client_id'] as string,
      reply_to_id: (doc['reply_to_id'] as string) ?? null,
      reply_to_preview: (doc['reply_to_preview'] as string) ?? null,
      created_at: doc['created_at'] as string,
      delivered_at: (doc['delivered_at'] as string) ?? null,
      read_at: (doc['read_at'] as string) ?? null,
      edited_at: (doc['edited_at'] as string) ?? null,
      deleted_at: (doc['deleted_at'] as string) ?? null,
      attachments: (doc['attachments'] as Message['attachments']) ?? [],
      reactions: (doc['reactions'] as Message['reactions']) ?? [],
      metadata: typeof doc['metadata'] === 'string' ? JSON.parse(doc['metadata'] as string) : {},
    };
  }
}

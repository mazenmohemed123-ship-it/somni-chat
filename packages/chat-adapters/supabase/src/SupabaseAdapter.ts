import type { SupabaseClient, RealtimeChannel } from '@supabase/supabase-js';
import type {
  ChatAdapter, PaginationOptions, MessageQueryOptions, PaginatedResult, UnsubscribeFn,
  UploadAttachmentInput, UploadAttachmentResult,
} from '@somni/chat-core';
import type {
  Conversation, CreateConversationInput, UpdateConversationInput,
  Participant, AddParticipantInput,
  Message, SendMessageInput, EditMessageInput, Reaction, Attachment,
  UserPresence, PresenceUpdate, TypingUpdate,
  ChatEvent,
} from '@somni/chat-core';

export interface SupabaseAdapterConfig {
  client: SupabaseClient;
  schema?: string;
  /** Storage bucket for attachments (default: "chat-attachments") */
  storageBucket?: string;
  /**
   * When true (default), `connect()` verifies there is an authenticated
   * Supabase session and that its user id matches the one passed to the engine,
   * failing fast on misconfiguration. Set false for anonymous / custom-auth setups.
   */
  requireAuth?: boolean;
}

function inferFileType(mime: string): Attachment['file_type'] {
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime.startsWith('application/') || mime.startsWith('text/')) return 'document';
  return 'other';
}

function byteLength(file: Blob | ArrayBuffer | Uint8Array): number {
  if (file instanceof Uint8Array) return file.byteLength;
  if (file instanceof ArrayBuffer) return file.byteLength;
  return file.size;
}

/**
 * Supabase implementation of the ChatAdapter interface.
 * Uses Supabase Realtime channels for subscriptions and Postgres for persistence.
 */
export class SupabaseAdapter implements ChatAdapter {
  private readonly db: SupabaseClient;
  private readonly schema: string;
  private readonly channels = new Map<string, RealtimeChannel>();

  private readonly storageBucket: string;
  private readonly requireAuth: boolean;
  private readonly typingSenders = new Map<string, RealtimeChannel>();

  constructor(config: SupabaseAdapterConfig) {
    this.db = config.client;
    this.schema = config.schema ?? 'public';
    this.storageBucket = config.storageBucket ?? 'chat-attachments';
    this.requireAuth = config.requireAuth ?? true;
  }

  private table(name: string) {
    return this.db.schema(this.schema).from(name);
  }

  // ─── Lifecycle ────────────────────────────────────────────────────────────

  /** Resolve the signed-in Supabase user's id (or null when anonymous). */
  async getCurrentUserId(): Promise<string | null> {
    const { data, error } = await this.db.auth.getUser();
    if (error || !data?.user) return null;
    return data.user.id;
  }

  async connect(userId: string): Promise<void> {
    if (!this.requireAuth) return;
    const authedId = await this.getCurrentUserId();
    if (!authedId) {
      throw new Error(
        '[Supabase] connect: no authenticated session. Sign in first, or pass requireAuth:false.'
      );
    }
    if (userId && authedId !== userId) {
      throw new Error(
        `[Supabase] connect: userId "${userId}" does not match the authenticated session "${authedId}".`
      );
    }
  }

  async disconnect(): Promise<void> {
    for (const [, channel] of this.channels) {
      await this.db.removeChannel(channel);
    }
    for (const [, channel] of this.typingSenders) {
      await this.db.removeChannel(channel);
    }
    this.channels.clear();
    this.typingSenders.clear();
  }

  // ─── Conversations ────────────────────────────────────────────────────────

  async createConversation(input: CreateConversationInput): Promise<Conversation> {
    const { data, error } = await this.table('conversations')
      .insert({
        type: input.type,
        title: input.title ?? null,
        description: input.description ?? null,
        avatar_url: input.avatar_url ?? null,
        metadata: input.metadata ?? {},
      })
      .select()
      .single();

    if (error) throw new Error(`[Supabase] createConversation: ${error.message}`);

    // Add participants
    const participantRows = input.participant_ids.map((uid, i) => ({
      conversation_id: data.id,
      user_id: uid,
      role: i === 0 ? 'owner' : 'member',
    }));
    await this.table('participants').insert(participantRows);

    return data as Conversation;
  }

  async getConversation(id: string): Promise<Conversation | null> {
    const { data, error } = await this.table('conversations').select('*').eq('id', id).single();
    if (error) return null;
    return data as Conversation;
  }

  async listConversations(userId: string, opts?: PaginationOptions): Promise<PaginatedResult<Conversation>> {
    const limit = opts?.limit ?? 30;

    let query = this.table('participants')
      .select('conversation:conversations(*)')
      .eq('user_id', userId)
      .eq('status', 'active')
      .order('conversation(last_message_at)', { ascending: false })
      .limit(limit);

    if (opts?.cursor) {
      query = query.lt('conversation(last_message_at)', opts.cursor);
    }

    const { data, error } = await query;
    if (error) throw new Error(`[Supabase] listConversations: ${error.message}`);

    const items = (data ?? []).map((row: Record<string, unknown>) => row['conversation'] as Conversation);
    const lastItem = items[items.length - 1];

    return {
      items,
      has_more: items.length === limit,
      next_cursor: lastItem?.last_message_at ?? null,
    };
  }

  async updateConversation(id: string, input: UpdateConversationInput): Promise<Conversation> {
    const { data, error } = await this.table('conversations').update(input).eq('id', id).select().single();
    if (error) throw new Error(`[Supabase] updateConversation: ${error.message}`);
    return data as Conversation;
  }

  async deleteConversation(id: string): Promise<void> {
    const { error } = await this.table('conversations').update({ status: 'deleted' }).eq('id', id);
    if (error) throw new Error(`[Supabase] deleteConversation: ${error.message}`);
  }

  subscribeConversations(userId: string, callback: (event: ChatEvent) => void): UnsubscribeFn {
    const channelName = `conversations:user:${userId}`;
    const channel = this.db
      .channel(channelName)
      .on('postgres_changes', {
        event: '*',
        schema: this.schema,
        table: 'conversations',
        filter: `participants.user_id=eq.${userId}`,
      }, (payload) => {
        if (payload.eventType === 'UPDATE') {
          callback({ type: 'conversation:updated', payload: payload.new as Conversation });
        } else if (payload.eventType === 'DELETE') {
          callback({ type: 'conversation:deleted', payload: { id: (payload.old as { id: string }).id } });
        }
      })
      .subscribe();

    this.channels.set(channelName, channel);
    return () => {
      void this.db.removeChannel(channel);
      this.channels.delete(channelName);
    };
  }

  // ─── Participants ──────────────────────────────────────────────────────────

  async addParticipant(conversationId: string, input: AddParticipantInput): Promise<Participant> {
    const { data, error } = await this.table('participants')
      .insert({ conversation_id: conversationId, user_id: input.user_id, role: input.role ?? 'member' })
      .select()
      .single();
    if (error) throw new Error(`[Supabase] addParticipant: ${error.message}`);
    return data as Participant;
  }

  async removeParticipant(conversationId: string, userId: string): Promise<void> {
    const { error } = await this.table('participants')
      .update({ status: 'left' })
      .eq('conversation_id', conversationId)
      .eq('user_id', userId);
    if (error) throw new Error(`[Supabase] removeParticipant: ${error.message}`);
  }

  async listParticipants(conversationId: string): Promise<Participant[]> {
    const { data, error } = await this.table('participants')
      .select('*')
      .eq('conversation_id', conversationId)
      .eq('status', 'active');
    if (error) throw new Error(`[Supabase] listParticipants: ${error.message}`);
    return (data ?? []) as Participant[];
  }

  async updateParticipantRole(conversationId: string, userId: string, role: Participant['role']): Promise<Participant> {
    const { data, error } = await this.table('participants')
      .update({ role })
      .eq('conversation_id', conversationId)
      .eq('user_id', userId)
      .select()
      .single();
    if (error) throw new Error(`[Supabase] updateParticipantRole: ${error.message}`);
    return data as Participant;
  }

  // ─── Messages ─────────────────────────────────────────────────────────────

  async sendMessage(input: SendMessageInput): Promise<Message> {
    const { data, error } = await this.table('messages')
      .insert({
        conversation_id: input.conversation_id,
        content: input.content,
        type: input.type ?? 'text',
        reply_to_id: input.reply_to_id ?? null,
        client_id: input.client_id,
        metadata: input.metadata ?? {},
      })
      .select('*, attachments(*), reactions(*)')
      .single();

    if (error) throw new Error(`[Supabase] sendMessage: ${error.message}`);

    if (input.attachments?.length) {
      await this.table('attachments').insert(
        input.attachments.map((a) => ({ ...a, message_id: data.id }))
      );
    }

    return data as unknown as Message;
  }

  async editMessage(input: EditMessageInput): Promise<Message> {
    const { data, error } = await this.table('messages')
      .update({ content: input.content, edited_at: new Date().toISOString() })
      .eq('id', input.message_id)
      .select('*, attachments(*), reactions(*)')
      .single();
    if (error) throw new Error(`[Supabase] editMessage: ${error.message}`);
    return data as unknown as Message;
  }

  async deleteMessage(messageId: string): Promise<void> {
    const { error } = await this.table('messages')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', messageId);
    if (error) throw new Error(`[Supabase] deleteMessage: ${error.message}`);
  }

  async getMessage(messageId: string): Promise<Message | null> {
    const { data, error } = await this.table('messages')
      .select('*, attachments(*), reactions(*)')
      .eq('id', messageId)
      .single();
    if (error) return null;
    return data as unknown as Message;
  }

  async listMessages(conversationId: string, opts?: MessageQueryOptions): Promise<PaginatedResult<Message>> {
    const limit = opts?.limit ?? 50;
    let query = this.table('messages')
      .select('*, attachments(*), reactions(*)')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (!opts?.include_deleted) query = query.is('deleted_at', null);
    if (opts?.before) query = query.lt('created_at', opts.before);
    if (opts?.after) query = query.gt('created_at', opts.after);
    if (opts?.cursor) query = query.lt('created_at', opts.cursor);

    const { data, error } = await query;
    if (error) throw new Error(`[Supabase] listMessages: ${error.message}`);

    const items = ((data ?? []) as unknown as Message[]).reverse();
    const oldest = items[0];

    return {
      items,
      has_more: items.length === limit,
      next_cursor: oldest?.created_at ?? null,
    };
  }

  subscribeMessages(conversationId: string, callback: (event: ChatEvent) => void): UnsubscribeFn {
    const channelName = `messages:${conversationId}`;
    const channel = this.db
      .channel(channelName)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: this.schema,
        table: 'messages',
        filter: `conversation_id=eq.${conversationId}`,
      }, (payload) => {
        callback({ type: 'message:new', payload: payload.new as Message });
      })
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: this.schema,
        table: 'messages',
        filter: `conversation_id=eq.${conversationId}`,
      }, (payload) => {
        callback({ type: 'message:updated', payload: payload.new as Message });
      })
      .subscribe();

    this.channels.set(channelName, channel);
    return () => {
      void this.db.removeChannel(channel);
      this.channels.delete(channelName);
    };
  }

  // ─── Read Receipts ────────────────────────────────────────────────────────

  async markAsRead(conversationId: string, userId: string, messageId: string): Promise<void> {
    const { error } = await this.table('participants')
      .update({ last_read_message_id: messageId, last_read_at: new Date().toISOString() })
      .eq('conversation_id', conversationId)
      .eq('user_id', userId);
    if (error) throw new Error(`[Supabase] markAsRead: ${error.message}`);
  }

  // ─── Reactions ────────────────────────────────────────────────────────────

  async addReaction(messageId: string, userId: string, emoji: string): Promise<Reaction> {
    const { data, error } = await this.table('reactions')
      .upsert({ message_id: messageId, user_id: userId, emoji }, { onConflict: 'message_id,user_id,emoji' })
      .select()
      .single();
    if (error) throw new Error(`[Supabase] addReaction: ${error.message}`);
    return data as Reaction;
  }

  async removeReaction(messageId: string, userId: string, emoji: string): Promise<void> {
    const { error } = await this.table('reactions')
      .delete()
      .eq('message_id', messageId)
      .eq('user_id', userId)
      .eq('emoji', emoji);
    if (error) throw new Error(`[Supabase] removeReaction: ${error.message}`);
  }

  // ─── Attachments ──────────────────────────────────────────────────────────

  async uploadAttachment(input: UploadAttachmentInput): Promise<UploadAttachmentResult> {
    const bucket = input.bucket ?? this.storageBucket;
    const path = `${Date.now()}-${crypto.randomUUID()}-${input.file_name}`;

    const { error } = await this.db.storage
      .from(bucket)
      .upload(path, input.file as Blob, { contentType: input.mime_type, upsert: false });

    if (error) throw new Error(`[Supabase] uploadAttachment: ${error.message}`);

    const { data: pub } = this.db.storage.from(bucket).getPublicUrl(path);

    return {
      file_url: pub.publicUrl,
      file_name: input.file_name,
      file_type: inferFileType(input.mime_type),
      mime_type: input.mime_type,
      file_size: byteLength(input.file),
    };
  }

  // ─── Presence ─────────────────────────────────────────────────────────────

  async updatePresence(update: PresenceUpdate): Promise<void> {
    const { error } = await this.table('user_presence')
      .upsert({
        user_id: update.user_id,
        status: update.status,
        last_seen_at: new Date().toISOString(),
        device: update.device ?? null,
      }, { onConflict: 'user_id' });
    if (error) throw new Error(`[Supabase] updatePresence: ${error.message}`);
  }

  async getPresence(userIds: string[]): Promise<UserPresence[]> {
    const { data, error } = await this.table('user_presence').select('*').in('user_id', userIds);
    if (error) throw new Error(`[Supabase] getPresence: ${error.message}`);
    return (data ?? []) as UserPresence[];
  }

  subscribePresence(userIds: string[], callback: (event: ChatEvent) => void): UnsubscribeFn {
    const channelName = `presence:${userIds.sort().join(',')}`;
    const channel = this.db
      .channel(channelName)
      .on('postgres_changes', {
        event: '*',
        schema: this.schema,
        table: 'user_presence',
        filter: `user_id=in.(${userIds.join(',')})`,
      }, (payload) => {
        callback({ type: 'presence:updated', payload: payload.new as UserPresence });
      })
      .subscribe();

    this.channels.set(channelName, channel);
    return () => {
      void this.db.removeChannel(channel);
      this.channels.delete(channelName);
    };
  }

  // ─── Typing ───────────────────────────────────────────────────────────────

  async updateTyping(update: TypingUpdate): Promise<void> {
    // Broadcasts require a subscribed channel. Reuse one sender per conversation
    // instead of creating (and leaking) a fresh channel on every keystroke.
    const key = `typing:${update.conversation_id}`;
    let channel = this.typingSenders.get(key);
    if (!channel) {
      channel = this.db.channel(key, { config: { broadcast: { ack: false } } });
      channel.subscribe();
      this.typingSenders.set(key, channel);
    }
    await channel.send({
      type: 'broadcast',
      event: 'typing',
      payload: { user_id: update.user_id, is_typing: update.is_typing },
    });
  }

  subscribeTyping(conversationId: string, callback: (event: ChatEvent) => void): UnsubscribeFn {
    const channelName = `typing:${conversationId}`;
    const channel = this.db
      .channel(channelName)
      .on('broadcast', { event: 'typing' }, (payload) => {
        callback({
          type: 'typing:updated',
          payload: {
            conversation_id: conversationId,
            user_id: payload.payload.user_id as string,
            is_typing: payload.payload.is_typing as boolean,
            started_at: new Date().toISOString(),
          },
        });
      })
      .subscribe();

    this.channels.set(`typing_sub:${conversationId}`, channel);
    return () => {
      void this.db.removeChannel(channel);
      this.channels.delete(`typing_sub:${conversationId}`);
    };
  }
}

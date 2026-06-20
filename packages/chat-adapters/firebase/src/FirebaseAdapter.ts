import type {
  Firestore,
  CollectionReference,
  DocumentData,
} from 'firebase/firestore';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  addDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  limit as firestoreLimit,
  onSnapshot,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore';
import type { FirebaseStorage } from 'firebase/storage';
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';
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
  Attachment,
  UserPresence,
  PresenceUpdate,
  TypingUpdate,
  ChatEvent,
} from '@somni/chat-core';

export interface FirebaseAdapterConfig {
  firestore: Firestore;
  /** Required only if you call uploadAttachment() */
  storage?: FirebaseStorage;
  /** Storage path prefix for attachments (default: "chat-attachments") */
  storagePrefix?: string;
}

function inferFileType(mime: string): Attachment['file_type'] {
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime.startsWith('application/') || mime.startsWith('text/')) return 'document';
  return 'other';
}

/**
 * Firebase/Firestore implementation of ChatAdapter.
 * Uses Firestore collections for persistence and onSnapshot for realtime.
 */
export class FirebaseAdapter implements ChatAdapter {
  private readonly fs: Firestore;
  private readonly storage: FirebaseStorage | undefined;
  private readonly storagePrefix: string;
  private readonly unsubscribers: Array<() => void> = [];

  constructor(config: FirebaseAdapterConfig) {
    this.fs = config.firestore;
    this.storage = config.storage;
    this.storagePrefix = config.storagePrefix ?? 'chat-attachments';
  }

  async uploadAttachment(input: UploadAttachmentInput): Promise<UploadAttachmentResult> {
    if (!this.storage) {
      throw new Error('[Firebase] uploadAttachment requires `storage` in FirebaseAdapterConfig');
    }
    const prefix = input.bucket ?? this.storagePrefix;
    const path = `${prefix}/${Date.now()}-${input.file_name}`;
    const ref = storageRef(this.storage, path);

    const blob = input.file instanceof Blob ? input.file : new Blob([input.file as ArrayBuffer]);
    await uploadBytes(ref, blob, { contentType: input.mime_type });
    const url = await getDownloadURL(ref);

    return {
      file_url: url,
      file_name: input.file_name,
      file_type: inferFileType(input.mime_type),
      mime_type: input.mime_type,
      file_size: blob.size,
    };
  }

  private col(name: string): CollectionReference<DocumentData> {
    return collection(this.fs, name);
  }

  // ─── Lifecycle ────────────────────────────────────────────────────────────

  async connect(_userId: string): Promise<void> {}
  async disconnect(): Promise<void> {
    for (const unsub of this.unsubscribers) unsub();
    this.unsubscribers.length = 0;
  }

  // ─── Conversations ────────────────────────────────────────────────────────

  async createConversation(input: CreateConversationInput): Promise<Conversation> {
    const ref = await addDoc(this.col('conversations'), {
      type: input.type,
      title: input.title ?? null,
      description: input.description ?? null,
      avatar_url: input.avatar_url ?? null,
      status: 'active',
      metadata: input.metadata ?? {},
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      last_message_at: null,
      last_message_preview: null,
      created_by: input.participant_ids[0] ?? '',
    });

    await Promise.all(
      input.participant_ids.map((uid, i) =>
        addDoc(this.col('participants'), {
          conversation_id: ref.id,
          user_id: uid,
          role: i === 0 ? 'owner' : 'member',
          status: 'active',
          joined_at: new Date().toISOString(),
          last_read_at: null,
          last_read_message_id: null,
          notifications_muted: false,
          metadata: {},
        })
      )
    );

    const snap = await getDoc(ref);
    return { id: snap.id, ...snap.data() } as Conversation;
  }

  async getConversation(id: string): Promise<Conversation | null> {
    const snap = await getDoc(doc(this.fs, 'conversations', id));
    if (!snap.exists()) return null;
    return { id: snap.id, ...snap.data() } as Conversation;
  }

  async listConversations(userId: string, opts?: PaginationOptions): Promise<PaginatedResult<Conversation>> {
    const lim = opts?.limit ?? 30;
    const participantSnap = await getDocs(
      query(this.col('participants'), where('user_id', '==', userId), where('status', '==', 'active'))
    );
    const ids = participantSnap.docs.map((d) => d.data()['conversation_id'] as string);
    if (!ids.length) return { items: [], has_more: false, next_cursor: null };

    // Firestore `in` query is limited to 30 items; chunk if needed
    const chunks = [];
    for (let i = 0; i < ids.length; i += 30) chunks.push(ids.slice(i, i + 30));

    const items: Conversation[] = [];
    for (const chunk of chunks) {
      const snap = await getDocs(
        query(this.col('conversations'), where('__name__', 'in', chunk), orderBy('last_message_at', 'desc'), firestoreLimit(lim))
      );
      snap.forEach((d) => items.push({ id: d.id, ...d.data() } as Conversation));
    }

    return { items: items.slice(0, lim), has_more: items.length >= lim, next_cursor: items[items.length - 1]?.last_message_at ?? null };
  }

  async updateConversation(id: string, input: UpdateConversationInput): Promise<Conversation> {
    const ref = doc(this.fs, 'conversations', id);
    await updateDoc(ref, { ...input, updated_at: new Date().toISOString() });
    const snap = await getDoc(ref);
    return { id: snap.id, ...snap.data() } as Conversation;
  }

  async deleteConversation(id: string): Promise<void> {
    await updateDoc(doc(this.fs, 'conversations', id), { status: 'deleted' });
  }

  subscribeConversations(_userId: string, callback: (event: ChatEvent) => void): UnsubscribeFn {
    const unsub = onSnapshot(this.col('conversations'), (snap) => {
      snap.docChanges().forEach((change) => {
        if (change.type === 'modified') {
          callback({ type: 'conversation:updated', payload: { id: change.doc.id, ...change.doc.data() } as Conversation });
        } else if (change.type === 'removed') {
          callback({ type: 'conversation:deleted', payload: { id: change.doc.id } });
        }
      });
    });
    this.unsubscribers.push(unsub);
    return unsub;
  }

  // ─── Participants ──────────────────────────────────────────────────────────

  async addParticipant(conversationId: string, input: AddParticipantInput): Promise<Participant> {
    const ref = await addDoc(this.col('participants'), {
      conversation_id: conversationId,
      user_id: input.user_id,
      role: input.role ?? 'member',
      status: 'active',
      joined_at: new Date().toISOString(),
      notifications_muted: false,
      metadata: {},
    });
    const snap = await getDoc(ref);
    return snap.data() as Participant;
  }

  async removeParticipant(conversationId: string, userId: string): Promise<void> {
    const snap = await getDocs(
      query(this.col('participants'), where('conversation_id', '==', conversationId), where('user_id', '==', userId))
    );
    await Promise.all(snap.docs.map((d) => updateDoc(d.ref, { status: 'left' })));
  }

  async listParticipants(conversationId: string): Promise<Participant[]> {
    const snap = await getDocs(
      query(this.col('participants'), where('conversation_id', '==', conversationId), where('status', '==', 'active'))
    );
    return snap.docs.map((d) => d.data() as Participant);
  }

  async updateParticipantRole(conversationId: string, userId: string, role: Participant['role']): Promise<Participant> {
    const snap = await getDocs(
      query(this.col('participants'), where('conversation_id', '==', conversationId), where('user_id', '==', userId))
    );
    if (!snap.docs.length) throw new Error('Participant not found');
    await updateDoc(snap.docs[0]!.ref, { role });
    return { ...snap.docs[0]!.data(), role } as Participant;
  }

  // ─── Messages ─────────────────────────────────────────────────────────────

  async sendMessage(input: SendMessageInput): Promise<Message> {
    const ref = await addDoc(this.col('messages'), {
      conversation_id: input.conversation_id,
      content: input.content,
      type: input.type ?? 'text',
      reply_to_id: input.reply_to_id ?? null,
      client_id: input.client_id,
      status: 'sent',
      created_at: new Date().toISOString(),
      metadata: input.metadata ?? {},
      attachments: [],
      reactions: [],
    });

    await updateDoc(doc(this.fs, 'conversations', input.conversation_id), {
      last_message_at: new Date().toISOString(),
      last_message_preview: (input.content as string).slice(0, 100),
    });

    const snap = await getDoc(ref);
    return { id: snap.id, ...snap.data() } as Message;
  }

  async editMessage(input: EditMessageInput): Promise<Message> {
    const ref = doc(this.fs, 'messages', input.message_id);
    await updateDoc(ref, { content: input.content, edited_at: new Date().toISOString() });
    const snap = await getDoc(ref);
    return { id: snap.id, ...snap.data() } as Message;
  }

  async deleteMessage(messageId: string): Promise<void> {
    await updateDoc(doc(this.fs, 'messages', messageId), { deleted_at: new Date().toISOString() });
  }

  async getMessage(messageId: string): Promise<Message | null> {
    const snap = await getDoc(doc(this.fs, 'messages', messageId));
    if (!snap.exists()) return null;
    return { id: snap.id, ...snap.data() } as Message;
  }

  async listMessages(conversationId: string, opts?: MessageQueryOptions): Promise<PaginatedResult<Message>> {
    const lim = opts?.limit ?? 50;
    const constraints = [
      where('conversation_id', '==', conversationId),
      orderBy('created_at', 'desc'),
      firestoreLimit(lim),
    ];

    const snap = await getDocs(query(this.col('messages'), ...constraints));
    const items = snap.docs.map((d) => ({ id: d.id, ...d.data() } as Message)).reverse();

    return { items, has_more: items.length === lim, next_cursor: items[0]?.created_at ?? null };
  }

  subscribeMessages(conversationId: string, callback: (event: ChatEvent) => void): UnsubscribeFn {
    const unsub = onSnapshot(
      query(this.col('messages'), where('conversation_id', '==', conversationId), orderBy('created_at', 'desc'), firestoreLimit(50)),
      (snap) => {
        snap.docChanges().forEach((change) => {
          const msg = { id: change.doc.id, ...change.doc.data() } as Message;
          if (change.type === 'added') callback({ type: 'message:new', payload: msg });
          else if (change.type === 'modified') callback({ type: 'message:updated', payload: msg });
        });
      }
    );
    this.unsubscribers.push(unsub);
    return unsub;
  }

  async markAsRead(conversationId: string, userId: string, messageId: string): Promise<void> {
    const snap = await getDocs(
      query(this.col('participants'), where('conversation_id', '==', conversationId), where('user_id', '==', userId))
    );
    if (snap.docs.length) {
      await updateDoc(snap.docs[0]!.ref, { last_read_message_id: messageId, last_read_at: new Date().toISOString() });
    }
  }

  async addReaction(messageId: string, userId: string, emoji: string): Promise<Reaction> {
    const id = `${messageId}_${userId}_${emoji}`;
    const reaction: Reaction = { message_id: messageId, user_id: userId, emoji, created_at: new Date().toISOString() };
    await setDoc(doc(this.fs, 'reactions', id), reaction);
    return reaction;
  }

  async removeReaction(messageId: string, userId: string, emoji: string): Promise<void> {
    await deleteDoc(doc(this.fs, 'reactions', `${messageId}_${userId}_${emoji}`));
  }

  async updatePresence(update: PresenceUpdate): Promise<void> {
    await setDoc(doc(this.fs, 'presence', update.user_id), {
      user_id: update.user_id,
      status: update.status,
      last_seen_at: new Date().toISOString(),
      device: update.device ?? null,
      metadata: {},
    });
  }

  async getPresence(userIds: string[]): Promise<UserPresence[]> {
    const results = await Promise.all(userIds.map((id) => getDoc(doc(this.fs, 'presence', id))));
    return results.filter((s) => s.exists()).map((s) => s.data() as UserPresence);
  }

  subscribePresence(userIds: string[], callback: (event: ChatEvent) => void): UnsubscribeFn {
    const unsubs = userIds.map((id) =>
      onSnapshot(doc(this.fs, 'presence', id), (snap) => {
        if (snap.exists()) {
          callback({ type: 'presence:updated', payload: snap.data() as UserPresence });
        }
      })
    );
    const combined = () => unsubs.forEach((u) => u());
    this.unsubscribers.push(combined);
    return combined;
  }

  async updateTyping(update: TypingUpdate): Promise<void> {
    const ref = doc(this.fs, 'typing_indicators', `${update.conversation_id}_${update.user_id}`);
    if (update.is_typing) {
      await setDoc(ref, { conversation_id: update.conversation_id, user_id: update.user_id, started_at: new Date().toISOString() });
    } else {
      await deleteDoc(ref);
    }
  }

  subscribeTyping(conversationId: string, callback: (event: ChatEvent) => void): UnsubscribeFn {
    const unsub = onSnapshot(
      query(this.col('typing_indicators'), where('conversation_id', '==', conversationId)),
      (snap) => {
        snap.docChanges().forEach((change) => {
          const payload = change.doc.data();
          callback({
            type: 'typing:updated',
            payload: {
              conversation_id: conversationId,
              user_id: payload['user_id'] as string,
              is_typing: change.type !== 'removed',
              started_at: (payload['started_at'] as string) ?? new Date().toISOString(),
            },
          });
        });
      }
    );
    this.unsubscribers.push(unsub);
    return unsub;
  }
}

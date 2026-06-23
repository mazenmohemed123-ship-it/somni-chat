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
  setDoc,
  startAfter,
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
 *
 * Fixes vs naive implementation:
 *  - subscribeMessages skips the initial snapshot so only genuinely new messages
 *    fire message:new (Firestore fires 'added' for ALL existing docs on first call).
 *  - sendMessage includes sender_id from the stored userId set in connect().
 *  - subscribeConversations filters to only conversations the user participates in.
 *  - Typing uses per-conversation document IDs to avoid unbounded collection scans.
 */
export class FirebaseAdapter implements ChatAdapter {
  private readonly fs: Firestore;
  private readonly storage: FirebaseStorage | undefined;
  private readonly storagePrefix: string;
  private readonly unsubscribers: Array<() => void> = [];
  private currentUserId: string | null = null;

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

  async connect(userId: string): Promise<void> {
    this.currentUserId = userId;
  }

  async disconnect(): Promise<void> {
    for (const unsub of this.unsubscribers) unsub();
    this.unsubscribers.length = 0;
    this.currentUserId = null;
  }

  // ─── Conversations ────────────────────────────────────────────────────────

  async createConversation(input: CreateConversationInput): Promise<Conversation> {
    const now = new Date().toISOString();
    const ref = await addDoc(this.col('conversations'), {
      type: input.type,
      title: input.title ?? null,
      description: input.description ?? null,
      avatar_url: input.avatar_url ?? null,
      status: 'active',
      metadata: input.metadata ?? {},
      created_at: now,
      updated_at: now,
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
          joined_at: now,
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

    // Fetch conversation IDs the user participates in
    const participantSnap = await getDocs(
      query(this.col('participants'), where('user_id', '==', userId), where('status', '==', 'active'))
    );
    const ids = participantSnap.docs.map((d) => d.data()['conversation_id'] as string);
    if (!ids.length) return { items: [], has_more: false, next_cursor: null };

    // Firestore 'in' is capped at 30 — chunk if needed
    const chunks: string[][] = [];
    for (let i = 0; i < ids.length; i += 30) chunks.push(ids.slice(i, i + 30));

    const items: Conversation[] = [];
    for (const chunk of chunks) {
      const snap = await getDocs(
        query(this.col('conversations'), where('__name__', 'in', chunk), orderBy('last_message_at', 'desc'), firestoreLimit(lim))
      );
      snap.forEach((d) => items.push({ id: d.id, ...d.data() } as Conversation));
    }

    const page = items.slice(0, lim);
    return { items: page, has_more: items.length >= lim, next_cursor: page[page.length - 1]?.last_message_at ?? null };
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

  subscribeConversations(userId: string, callback: (event: ChatEvent) => void): UnsubscribeFn {
    // Only watch conversations the user actually participates in
    const participantQuery = query(
      this.col('participants'),
      where('user_id', '==', userId),
      where('status', '==', 'active')
    );

    const unsub = onSnapshot(participantQuery, async (participantSnap) => {
      const ids = participantSnap.docs.map((d) => d.data()['conversation_id'] as string);
      if (!ids.length) return;

      // Watch the first 30 conversations (Firestore 'in' limit)
      const convUnsub = onSnapshot(
        query(this.col('conversations'), where('__name__', 'in', ids.slice(0, 30))),
        (snap) => {
          snap.docChanges().forEach((change) => {
            if (change.type === 'modified') {
              callback({ type: 'conversation:updated', payload: { id: change.doc.id, ...change.doc.data() } as Conversation });
            } else if (change.type === 'removed') {
              callback({ type: 'conversation:deleted', payload: { id: change.doc.id } as never });
            }
          });
        }
      );
      this.unsubscribers.push(convUnsub);
    });

    this.unsubscribers.push(unsub);
    return unsub;
  }

  // ─── Participants ──────────────────────────────────────────────────────────

  async addParticipant(conversationId: string, input: AddParticipantInput): Promise<Participant> {
    const now = new Date().toISOString();
    const data: Participant = {
      conversation_id: conversationId,
      user_id: input.user_id,
      role: input.role ?? 'member',
      status: 'active',
      joined_at: now,
      last_read_at: null,
      last_read_message_id: null,
      notifications_muted: false,
      metadata: {},
    };
    await addDoc(this.col('participants'), data);
    return data;
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
    if (!snap.docs.length) throw new Error('[Firebase] Participant not found');
    await updateDoc(snap.docs[0]!.ref, { role });
    return { ...snap.docs[0]!.data(), role } as Participant;
  }

  // ─── Messages ─────────────────────────────────────────────────────────────

  async sendMessage(input: SendMessageInput): Promise<Message> {
    if (!this.currentUserId) throw new Error('[Firebase] call connect() before sendMessage()');
    const now = new Date().toISOString();

    const data = {
      conversation_id: input.conversation_id,
      sender_id: this.currentUserId,      // ← was missing in the original
      content: input.content,
      type: input.type ?? 'text',
      reply_to_id: input.reply_to_id ?? null,
      reply_to_preview: null,
      client_id: input.client_id,
      status: 'sent',
      created_at: now,
      delivered_at: now,
      read_at: null,
      edited_at: null,
      deleted_at: null,
      attachments: [],
      reactions: [],
      metadata: input.metadata ?? {},
    };

    const ref = await addDoc(this.col('messages'), data);

    // Update conversation summary
    await updateDoc(doc(this.fs, 'conversations', input.conversation_id), {
      last_message_at: now,
      last_message_preview: String(input.content).slice(0, 100),
      updated_at: now,
    });

    return { id: ref.id, ...data } as Message;
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
      where('deleted_at', '==', null),
      orderBy('created_at', 'desc'),
      firestoreLimit(lim + 1), // fetch one extra to detect has_more
    ];

    if (opts?.cursor) {
      const cursorDoc = await getDoc(doc(this.fs, 'messages', opts.cursor));
      if (cursorDoc.exists()) constraints.push(startAfter(cursorDoc));
    }

    const snap = await getDocs(query(this.col('messages'), ...constraints));
    const all = snap.docs.map((d) => ({ id: d.id, ...d.data() } as Message));
    const hasMore = all.length > lim;
    const items = all.slice(0, lim).reverse(); // chronological for display

    return {
      items,
      has_more: hasMore,
      next_cursor: hasMore ? all[lim - 1]?.id ?? null : null,
    };
  }

  subscribeMessages(conversationId: string, callback: (event: ChatEvent) => void): UnsubscribeFn {
    // Track whether the initial snapshot has been processed.
    // Firestore fires 'added' for ALL existing documents on first call — we must
    // skip those so we don't replay history as message:new events.
    let initialSnapshotDone = false;

    const unsub = onSnapshot(
      query(
        this.col('messages'),
        where('conversation_id', '==', conversationId),
        orderBy('created_at', 'asc'),
        firestoreLimit(50)
      ),
      (snap) => {
        if (!initialSnapshotDone) {
          initialSnapshotDone = true;
          return; // skip the initial load — the caller uses listMessages() for history
        }
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

  // ─── Read Receipts ────────────────────────────────────────────────────────

  async markAsRead(conversationId: string, userId: string, messageId: string): Promise<void> {
    const snap = await getDocs(
      query(this.col('participants'), where('conversation_id', '==', conversationId), where('user_id', '==', userId))
    );
    if (snap.docs.length) {
      await updateDoc(snap.docs[0]!.ref, {
        last_read_message_id: messageId,
        last_read_at: new Date().toISOString(),
      });
    }
  }

  // ─── Reactions ────────────────────────────────────────────────────────────

  async addReaction(messageId: string, userId: string, emoji: string): Promise<Reaction> {
    const id = `${messageId}_${userId}_${emoji}`;
    const reaction: Reaction = {
      message_id: messageId,
      user_id: userId,
      emoji,
      created_at: new Date().toISOString(),
    };
    await setDoc(doc(this.fs, 'reactions', id), reaction);
    return reaction;
  }

  async removeReaction(messageId: string, userId: string, emoji: string): Promise<void> {
    await deleteDoc(doc(this.fs, 'reactions', `${messageId}_${userId}_${emoji}`));
  }

  // ─── Presence ─────────────────────────────────────────────────────────────

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

  // ─── Typing ───────────────────────────────────────────────────────────────
  //
  // We store a single document per (conversation, user) — no collection scans,
  // no unbounded growth. Deletion = stopped typing; presence = actively typing.

  async updateTyping(update: TypingUpdate): Promise<void> {
    const ref = doc(this.fs, 'typing_indicators', `${update.conversation_id}_${update.user_id}`);
    if (update.is_typing) {
      await setDoc(ref, {
        conversation_id: update.conversation_id,
        user_id: update.user_id,
        is_typing: true,
        started_at: new Date().toISOString(),
      });
    } else {
      await deleteDoc(ref);
    }
  }

  subscribeTyping(conversationId: string, callback: (event: ChatEvent) => void): UnsubscribeFn {
    let initialDone = false;
    const unsub = onSnapshot(
      query(this.col('typing_indicators'), where('conversation_id', '==', conversationId)),
      (snap) => {
        if (!initialDone) { initialDone = true; return; }
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

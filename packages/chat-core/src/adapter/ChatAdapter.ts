import type {
  Conversation,
  CreateConversationInput,
  UpdateConversationInput,
} from '../types/conversation';
import type { Participant, AddParticipantInput } from '../types/participant';
import type {
  Message,
  SendMessageInput,
  EditMessageInput,
  Reaction,
} from '../types/message';
import type { UserPresence, PresenceUpdate, TypingUpdate } from '../types/presence';
import type { ChatEvent } from '../types/events';

export type UnsubscribeFn = () => void;

/**
 * The contract every backend adapter must implement.
 * The Core Engine knows NOTHING about the underlying database.
 */
export interface ChatAdapter {
  // ─── Lifecycle ──────────────────────────────────────────────────────────
  connect(userId: string): Promise<void>;
  disconnect(): Promise<void>;

  // ─── Conversations ───────────────────────────────────────────────────────
  createConversation(input: CreateConversationInput): Promise<Conversation>;
  getConversation(id: string): Promise<Conversation | null>;
  listConversations(userId: string, opts?: PaginationOptions): Promise<PaginatedResult<Conversation>>;
  updateConversation(id: string, input: UpdateConversationInput): Promise<Conversation>;
  deleteConversation(id: string): Promise<void>;
  subscribeConversations(
    userId: string,
    callback: (event: ChatEvent) => void
  ): UnsubscribeFn;

  // ─── Participants ────────────────────────────────────────────────────────
  addParticipant(conversationId: string, input: AddParticipantInput): Promise<Participant>;
  removeParticipant(conversationId: string, userId: string): Promise<void>;
  listParticipants(conversationId: string): Promise<Participant[]>;
  updateParticipantRole(conversationId: string, userId: string, role: Participant['role']): Promise<Participant>;

  // ─── Messages ────────────────────────────────────────────────────────────
  sendMessage(input: SendMessageInput): Promise<Message>;
  editMessage(input: EditMessageInput): Promise<Message>;
  deleteMessage(messageId: string): Promise<void>;
  getMessage(messageId: string): Promise<Message | null>;
  listMessages(conversationId: string, opts?: MessageQueryOptions): Promise<PaginatedResult<Message>>;
  subscribeMessages(
    conversationId: string,
    callback: (event: ChatEvent) => void
  ): UnsubscribeFn;

  // ─── Read Receipts ────────────────────────────────────────────────────────
  markAsRead(conversationId: string, userId: string, messageId: string): Promise<void>;

  // ─── Reactions ────────────────────────────────────────────────────────────
  addReaction(messageId: string, userId: string, emoji: string): Promise<Reaction>;
  removeReaction(messageId: string, userId: string, emoji: string): Promise<void>;

  // ─── Presence ─────────────────────────────────────────────────────────────
  updatePresence(update: PresenceUpdate): Promise<void>;
  getPresence(userIds: string[]): Promise<UserPresence[]>;
  subscribePresence(
    userIds: string[],
    callback: (event: ChatEvent) => void
  ): UnsubscribeFn;

  // ─── Typing ───────────────────────────────────────────────────────────────
  updateTyping(update: TypingUpdate): Promise<void>;
  subscribeTyping(
    conversationId: string,
    callback: (event: ChatEvent) => void
  ): UnsubscribeFn;
}

export interface PaginationOptions {
  limit?: number;
  cursor?: string;
  direction?: 'asc' | 'desc';
}

export interface MessageQueryOptions extends PaginationOptions {
  before?: string;
  after?: string;
  include_deleted?: boolean;
}

export interface PaginatedResult<T> {
  items: T[];
  next_cursor: string | null;
  has_more: boolean;
  total?: number;
}

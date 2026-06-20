export type MessageType = 'text' | 'attachment' | 'system' | 'reply' | 'ai';

export type MessageStatus = 'pending' | 'sent' | 'delivered' | 'failed';

export interface Message {
  id: string;
  conversation_id: string;
  sender_id: string;
  type: MessageType;
  content: string;
  status: MessageStatus;

  // Deduplication — client-generated UUID prevents duplicates on retry
  client_id: string;

  // Threading
  reply_to_id: string | null;
  reply_to_preview: string | null;

  // Lifecycle timestamps
  created_at: string;
  delivered_at: string | null;
  read_at: string | null;
  edited_at: string | null;
  deleted_at: string | null;

  // Relations (hydrated on fetch)
  attachments: Attachment[];
  reactions: Reaction[];

  metadata: Record<string, unknown>;
}

export interface Attachment {
  id: string;
  message_id: string;
  file_url: string;
  file_name: string;
  file_type: 'image' | 'video' | 'audio' | 'document' | 'other';
  mime_type: string;
  file_size: number;
  thumbnail_url: string | null;
  width: number | null;
  height: number | null;
  duration_seconds: number | null;
  created_at: string;
}

export interface Reaction {
  message_id: string;
  user_id: string;
  emoji: string;
  created_at: string;
}

export interface SendMessageInput {
  conversation_id: string;
  content: string;
  type?: MessageType;
  reply_to_id?: string;
  attachments?: AttachmentInput[];
  metadata?: Record<string, unknown>;
  client_id?: string;
}

export interface AttachmentInput {
  file_url: string;
  file_name: string;
  file_type: Attachment['file_type'];
  mime_type: string;
  file_size: number;
  thumbnail_url?: string;
  width?: number;
  height?: number;
  duration_seconds?: number;
}

export interface EditMessageInput {
  message_id: string;
  content: string;
}

// Optimistic message — used before server confirmation
export interface OptimisticMessage extends Omit<Message, 'id'> {
  id: string;
  _optimistic: true;
}

export type AnyMessage = Message | OptimisticMessage;

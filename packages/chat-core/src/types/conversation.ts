export type ConversationType = 'direct' | 'group' | 'channel' | 'support' | 'ai';

export type ConversationStatus = 'active' | 'archived' | 'deleted';

export interface Conversation {
  id: string;
  type: ConversationType;
  title: string | null;
  description: string | null;
  avatar_url: string | null;
  status: ConversationStatus;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  last_message_at: string | null;
  last_message_preview: string | null;
  created_by: string;
}

export interface CreateConversationInput {
  type: ConversationType;
  title?: string;
  description?: string;
  avatar_url?: string;
  participant_ids: string[];
  metadata?: Record<string, unknown>;
}

export interface UpdateConversationInput {
  title?: string;
  description?: string;
  avatar_url?: string;
  metadata?: Record<string, unknown>;
}

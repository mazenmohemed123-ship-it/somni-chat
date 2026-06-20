export type PresenceStatus = 'online' | 'away' | 'busy' | 'offline';

export interface UserPresence {
  user_id: string;
  status: PresenceStatus;
  last_seen_at: string;
  device: string | null;
  metadata: Record<string, unknown>;
}

export interface TypingIndicator {
  conversation_id: string;
  user_id: string;
  started_at: string;
}

export interface PresenceUpdate {
  user_id: string;
  status: PresenceStatus;
  device?: string;
}

export interface TypingUpdate {
  conversation_id: string;
  user_id: string;
  is_typing: boolean;
}

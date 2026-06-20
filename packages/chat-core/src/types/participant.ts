export type ParticipantRole = 'owner' | 'admin' | 'member' | 'guest' | 'bot';

export type ParticipantStatus = 'active' | 'left' | 'banned' | 'invited';

export interface Participant {
  conversation_id: string;
  user_id: string;
  role: ParticipantRole;
  status: ParticipantStatus;
  joined_at: string;
  last_read_at: string | null;
  last_read_message_id: string | null;
  notifications_muted: boolean;
  metadata: Record<string, unknown>;
}

export interface AddParticipantInput {
  user_id: string;
  role?: ParticipantRole;
}

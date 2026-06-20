import type { AnyMessage } from './message';
import type { Conversation } from './conversation';
import type { Participant } from './participant';
import type { UserPresence, TypingIndicator } from './presence';

// Discriminated union of all realtime events the engine emits
export type ChatEvent =
  | { type: 'message:new'; payload: AnyMessage }
  | { type: 'message:updated'; payload: AnyMessage }
  | { type: 'message:deleted'; payload: { id: string; conversation_id: string } }
  | { type: 'message:reaction'; payload: { message_id: string; user_id: string; emoji: string; action: 'add' | 'remove' } }
  | { type: 'conversation:updated'; payload: Conversation }
  | { type: 'conversation:deleted'; payload: { id: string } }
  | { type: 'participant:joined'; payload: Participant }
  | { type: 'participant:left'; payload: { conversation_id: string; user_id: string } }
  | { type: 'presence:updated'; payload: UserPresence }
  | { type: 'typing:updated'; payload: TypingIndicator & { is_typing: boolean } }
  | { type: 'connection:connected' }
  | { type: 'connection:disconnected'; payload: { reason: string } }
  | { type: 'connection:reconnecting'; payload: { attempt: number } }
  | { type: 'error'; payload: { code: string; message: string; context?: unknown } };

export type ChatEventType = ChatEvent['type'];

export type ChatEventPayload<T extends ChatEventType> = Extract<ChatEvent, { type: T }> extends { payload: infer P }
  ? P
  : never;

export type EventListener<T extends ChatEventType = ChatEventType> = (
  event: Extract<ChatEvent, { type: T }>
) => void | Promise<void>;

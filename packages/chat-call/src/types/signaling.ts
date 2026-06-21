import type { CallType, CallEndReason } from './call';

/**
 * Transport-agnostic signaling messages. These travel over a {@link CallSignaling}
 * channel — which can be backed by the existing Somni chat realtime, a raw
 * WebSocket, or anything else. The call engine never assumes a transport.
 */
export type SignalMessage =
  | { kind: 'invite'; call_id: string; conversation_id: string; from: string; call_type: CallType; to?: string }
  | { kind: 'accept'; call_id: string; from: string; to?: string }
  | { kind: 'reject'; call_id: string; from: string; reason?: CallEndReason }
  | { kind: 'cancel'; call_id: string; from: string }
  | { kind: 'leave'; call_id: string; from: string }
  | { kind: 'offer'; call_id: string; from: string; to: string; sdp: string }
  | { kind: 'answer'; call_id: string; from: string; to: string; sdp: string }
  | { kind: 'ice'; call_id: string; from: string; to: string; candidate: unknown }
  | { kind: 'media-state'; call_id: string; from: string; audio_enabled: boolean; video_enabled: boolean };

export type SignalKind = SignalMessage['kind'];

/**
 * The signaling transport contract. Implementations fan a single subscription
 * out to all local listeners.
 */
export interface CallSignaling {
  /** Publish a signaling message to the other participant(s). */
  send(message: SignalMessage): Promise<void> | void;
  /** Subscribe to inbound signaling messages. Returns an unsubscribe fn. */
  subscribe(callback: (message: SignalMessage) => void): () => void;
}

import type { CallSession, CallParticipant, CallEndReason, RemoteTrack, MediaStreamLike } from './call';

/** Events emitted by the CallEngine to the application/UI. */
export type CallEvent =
  | { type: 'call:incoming'; payload: CallSession }
  | { type: 'call:outgoing'; payload: CallSession }
  | { type: 'call:state'; payload: { call_id: string; state: CallSession['state'] } }
  | { type: 'call:connected'; payload: CallSession }
  | { type: 'call:ended'; payload: { call_id: string; reason: CallEndReason } }
  | { type: 'participant:joined'; payload: CallParticipant }
  | { type: 'participant:left'; payload: { user_id: string } }
  | { type: 'participant:media'; payload: CallParticipant }
  | { type: 'local-stream'; payload: { stream: MediaStreamLike } }
  | { type: 'remote-track'; payload: RemoteTrack }
  | { type: 'remote-track:removed'; payload: { user_id: string; kind: 'audio' | 'video' } }
  | { type: 'error'; payload: { code: string; message: string; context?: unknown } };

export type CallEventType = CallEvent['type'];

export type CallEventListener<T extends CallEventType = CallEventType> = (
  event: Extract<CallEvent, { type: T }>
) => void;

export type CallType = 'audio' | 'video';

export type CallState =
  | 'idle'
  | 'ringing' // outgoing: invite sent, waiting for accept
  | 'incoming' // incoming: invite received, not yet accepted
  | 'connecting' // accepted, media negotiating
  | 'connected'
  | 'reconnecting'
  | 'ended';

export type CallEndReason =
  | 'hangup'
  | 'remote-hangup'
  | 'rejected'
  | 'cancelled'
  | 'no-answer'
  | 'timeout'
  | 'error';

export interface MediaConstraints {
  audio: boolean;
  video: boolean;
}

export interface CallParticipant {
  user_id: string;
  is_local: boolean;
  audio_enabled: boolean;
  video_enabled: boolean;
  speaking: boolean;
  joined_at: string;
}

export interface CallSession {
  id: string;
  conversation_id: string;
  type: CallType;
  state: CallState;
  initiator_id: string;
  participants: CallParticipant[];
  started_at: string | null;
  connected_at: string | null;
  ended_at: string | null;
  end_reason: CallEndReason | null;
}

/**
 * A minimal media-stream shape so the engine and tests don't depend on the DOM
 * `MediaStream` type. In a browser this is satisfied by a real MediaStream.
 */
export interface MediaStreamLike {
  id: string;
  getTracks(): Array<{ kind: string; stop(): void; enabled: boolean }>;
}

export interface RemoteTrack {
  user_id: string;
  kind: 'audio' | 'video';
  stream: MediaStreamLike;
}

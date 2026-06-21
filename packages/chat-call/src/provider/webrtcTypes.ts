import type { MediaStreamLike } from '../types/call';

/**
 * Minimal structural subset of the WebRTC API the provider relies on. Real
 * browsers satisfy these; tests inject a fake. This keeps the provider testable
 * in Node with zero DOM.
 */
export interface RTCIceCandidateLike {
  candidate: string;
  sdpMid?: string | null;
  sdpMLineIndex?: number | null;
}

export interface RTCSessionDescriptionLike {
  type: 'offer' | 'answer' | 'pranswer' | 'rollback';
  sdp: string;
}

export interface RTCTrackEventLike {
  track: { kind: string; stop(): void; enabled: boolean };
  streams: MediaStreamLike[];
}

export interface PeerConnectionLike {
  connectionState: string;
  onicecandidate: ((ev: { candidate: RTCIceCandidateLike | null }) => void) | null;
  ontrack: ((ev: RTCTrackEventLike) => void) | null;
  onconnectionstatechange: (() => void) | null;

  addTrack(track: unknown, stream: MediaStreamLike): void;
  createOffer(): Promise<RTCSessionDescriptionLike>;
  createAnswer(): Promise<RTCSessionDescriptionLike>;
  setLocalDescription(desc: RTCSessionDescriptionLike): Promise<void>;
  setRemoteDescription(desc: RTCSessionDescriptionLike): Promise<void>;
  addIceCandidate(candidate: RTCIceCandidateLike): Promise<void>;
  close(): void;
}

export type PeerConnectionFactory = (config?: { iceServers?: Array<{ urls: string | string[] }> }) => PeerConnectionLike;

export type GetUserMediaFn = (constraints: { audio: boolean; video: boolean }) => Promise<MediaStreamLike>;

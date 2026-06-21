import type {
  PeerConnectionLike,
  PeerConnectionFactory,
  RTCSessionDescriptionLike,
  RTCIceCandidateLike,
  RTCTrackEventLike,
} from '../../src/provider/webrtcTypes.ts';
import { FakeMediaStream } from './fakeMedia.ts';

/**
 * A cooperative fake RTCPeerConnection. It does not do real ICE/DTLS, but it
 * faithfully drives the negotiation state machine so the provider + engine can
 * be exercised end-to-end in Node:
 *
 *  - createOffer/createAnswer return deterministic fake SDP.
 *  - setRemoteDescription schedules: one ICE candidate, an inbound `ontrack`,
 *    and a transition to connectionState === 'connected'.
 *
 * This lets a two-party call reach "connected" with remote tracks on both ends.
 */
export class FakeRTCPeerConnection implements PeerConnectionLike {
  connectionState = 'new';
  onicecandidate: ((ev: { candidate: RTCIceCandidateLike | null }) => void) | null = null;
  ontrack: ((ev: RTCTrackEventLike) => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;

  addedTracks: Array<{ kind: string }> = [];
  addedCandidates: RTCIceCandidateLike[] = [];
  closed = false;

  static instances: FakeRTCPeerConnection[] = [];

  constructor() {
    FakeRTCPeerConnection.instances.push(this);
  }

  addTrack(track: { kind: string }): void {
    this.addedTracks.push({ kind: track.kind });
  }

  async createOffer(): Promise<RTCSessionDescriptionLike> {
    return { type: 'offer', sdp: 'v=0\r\nfake-offer' };
  }

  async createAnswer(): Promise<RTCSessionDescriptionLike> {
    return { type: 'answer', sdp: 'v=0\r\nfake-answer' };
  }

  async setLocalDescription(_desc: RTCSessionDescriptionLike): Promise<void> {
    // Emit a trickle ICE candidate after local description is set.
    queueMicrotask(() => {
      this.onicecandidate?.({ candidate: { candidate: 'candidate:fake', sdpMid: '0', sdpMLineIndex: 0 } });
    });
  }

  async setRemoteDescription(_desc: RTCSessionDescriptionLike): Promise<void> {
    // Simulate the remote media + a successful connection.
    queueMicrotask(() => {
      const stream = new FakeMediaStream(['audio', 'video']);
      this.ontrack?.({ track: { kind: 'audio', stop() {}, enabled: true }, streams: [stream] });
      this.ontrack?.({ track: { kind: 'video', stop() {}, enabled: true }, streams: [stream] });
      this.connectionState = 'connected';
      this.onconnectionstatechange?.();
    });
  }

  async addIceCandidate(candidate: RTCIceCandidateLike): Promise<void> {
    this.addedCandidates.push(candidate);
  }

  close(): void {
    this.closed = true;
    this.connectionState = 'closed';
  }
}

export function fakePeerFactory(): PeerConnectionFactory {
  return () => new FakeRTCPeerConnection();
}

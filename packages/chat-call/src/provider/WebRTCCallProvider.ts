import type { CallProvider, CallProviderContext } from './CallProvider';
import type { SignalMessage } from '../types/signaling';
import type { MediaStreamLike } from '../types/call';
import type {
  PeerConnectionLike,
  PeerConnectionFactory,
  GetUserMediaFn,
  RTCSessionDescriptionLike,
} from './webrtcTypes';

export interface WebRTCCallProviderOptions {
  /** Factory for RTCPeerConnection. Defaults to the global `RTCPeerConnection`. */
  peerConnectionFactory?: PeerConnectionFactory;
  /** getUserMedia implementation. Defaults to `navigator.mediaDevices.getUserMedia`. */
  getUserMedia?: GetUserMediaFn;
  /** ICE servers (STUN/TURN). A public STUN server is used by default. */
  iceServers?: Array<{ urls: string | string[] }>;
}

function defaultPeerFactory(): PeerConnectionFactory {
  return (config) => {
    const Ctor = (globalThis as { RTCPeerConnection?: new (c?: unknown) => PeerConnectionLike })
      .RTCPeerConnection;
    if (!Ctor) throw new Error('[Somni Call] No RTCPeerConnection available; inject peerConnectionFactory.');
    return new Ctor(config);
  };
}

function defaultGetUserMedia(): GetUserMediaFn {
  return async (constraints) => {
    const md = (globalThis as {
      navigator?: { mediaDevices?: { getUserMedia(c: unknown): Promise<MediaStreamLike> } };
    }).navigator?.mediaDevices;
    if (!md) throw new Error('[Somni Call] No getUserMedia available; inject getUserMedia.');
    return md.getUserMedia(constraints);
  };
}

/**
 * Peer-to-peer mesh provider built on native WebRTC. The CallEngine drives
 * signaling, so this provider only translates between RTCPeerConnection and
 * {@link SignalMessage}.
 *
 * Glare avoidance: for any pair, the participant with the lexicographically
 * smaller id is the offerer. This guarantees exactly one offer per pair.
 */
export class WebRTCCallProvider implements CallProvider {
  readonly handlesSignaling = false;

  private readonly peerFactory: PeerConnectionFactory;
  private readonly getUserMedia: GetUserMediaFn;
  private readonly iceServers: Array<{ urls: string | string[] }>;

  private ctx: CallProviderContext | null = null;
  private localStream: MediaStreamLike | null = null;
  private readonly peers = new Map<string, PeerConnectionLike>();

  constructor(options: WebRTCCallProviderOptions = {}) {
    this.peerFactory = options.peerConnectionFactory ?? defaultPeerFactory();
    this.getUserMedia = options.getUserMedia ?? defaultGetUserMedia();
    this.iceServers = options.iceServers ?? [{ urls: 'stun:stun.l.google.com:19302' }];
  }

  async join(ctx: CallProviderContext): Promise<void> {
    this.ctx = ctx;
    this.localStream = await this.getUserMedia({
      audio: ctx.constraints.audio,
      video: ctx.constraints.video,
    });
    ctx.emit({ type: 'local-stream', stream: this.localStream });
    ctx.emit({ type: 'state', state: 'connecting' });

    // Initiate offers to peers we are responsible for.
    for (const peerId of ctx.peers) {
      if (this.isOfferer(peerId)) await this.createOfferTo(peerId);
    }
  }

  async addPeer(userId: string): Promise<void> {
    if (!this.ctx || this.peers.has(userId)) return;
    if (this.isOfferer(userId)) await this.createOfferTo(userId);
  }

  private isOfferer(peerId: string): boolean {
    return (this.ctx?.selfId ?? '') < peerId;
  }

  private getOrCreatePeer(peerId: string): PeerConnectionLike {
    let pc = this.peers.get(peerId);
    if (pc) return pc;

    pc = this.peerFactory({ iceServers: this.iceServers });
    this.peers.set(peerId, pc);

    pc.onicecandidate = (ev) => {
      if (ev.candidate && this.ctx) {
        void this.ctx.signaling.send({
          kind: 'ice',
          call_id: this.ctx.callId,
          from: this.ctx.selfId,
          to: peerId,
          candidate: ev.candidate,
        });
      }
    };

    pc.ontrack = (ev) => {
      const stream = ev.streams[0];
      if (stream && this.ctx) {
        this.ctx.emit({
          type: 'remote-track',
          track: { user_id: peerId, kind: ev.track.kind === 'video' ? 'video' : 'audio', stream },
        });
      }
    };

    pc.onconnectionstatechange = () => {
      if (!this.ctx) return;
      const state = pc!.connectionState;
      if (state === 'connected') {
        this.ctx.emit({ type: 'peer-joined', user_id: peerId });
        this.ctx.emit({ type: 'state', state: 'connected' });
      } else if (state === 'failed') {
        this.ctx.emit({ type: 'state', state: 'failed' });
      } else if (state === 'disconnected') {
        this.ctx.emit({ type: 'state', state: 'reconnecting' });
      }
    };

    // Publish local tracks.
    if (this.localStream) {
      for (const track of this.localStream.getTracks()) pc.addTrack(track, this.localStream);
    }
    return pc;
  }

  private async createOfferTo(peerId: string): Promise<void> {
    if (!this.ctx) return;
    const pc = this.getOrCreatePeer(peerId);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await this.ctx.signaling.send({
      kind: 'offer',
      call_id: this.ctx.callId,
      from: this.ctx.selfId,
      to: peerId,
      sdp: offer.sdp,
    });
  }

  async handleSignal(message: SignalMessage): Promise<void> {
    if (!this.ctx) return;
    if ('to' in message && message.to && message.to !== this.ctx.selfId) return;

    switch (message.kind) {
      case 'offer': {
        const pc = this.getOrCreatePeer(message.from);
        await pc.setRemoteDescription({ type: 'offer', sdp: message.sdp });
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        await this.ctx.signaling.send({
          kind: 'answer',
          call_id: this.ctx.callId,
          from: this.ctx.selfId,
          to: message.from,
          sdp: answer.sdp,
        });
        break;
      }
      case 'answer': {
        const pc = this.peers.get(message.from);
        if (pc) await pc.setRemoteDescription({ type: 'answer', sdp: message.sdp } as RTCSessionDescriptionLike);
        break;
      }
      case 'ice': {
        const pc = this.peers.get(message.from);
        if (pc && message.candidate) {
          await pc.addIceCandidate(message.candidate as never);
        }
        break;
      }
      default:
        break;
    }
  }

  async setMicEnabled(enabled: boolean): Promise<void> {
    this.toggleKind('audio', enabled);
  }

  async setCameraEnabled(enabled: boolean): Promise<void> {
    this.toggleKind('video', enabled);
  }

  private toggleKind(kind: 'audio' | 'video', enabled: boolean): void {
    for (const track of this.localStream?.getTracks() ?? []) {
      if (track.kind === kind) track.enabled = enabled;
    }
  }

  async leave(): Promise<void> {
    for (const [, pc] of this.peers) {
      try {
        pc.close();
      } catch {
        /* ignore */
      }
    }
    this.peers.clear();
    for (const track of this.localStream?.getTracks() ?? []) {
      try {
        track.stop();
      } catch {
        /* ignore */
      }
    }
    this.localStream = null;
    this.ctx = null;
  }

  /** Test/diagnostic helper. */
  get peerCount(): number {
    return this.peers.size;
  }
}

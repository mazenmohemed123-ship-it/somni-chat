import type { CallType, MediaConstraints, MediaStreamLike, RemoteTrack } from '../types/call';
import type { CallSignaling, SignalMessage } from '../types/signaling';

/**
 * Events a provider reports UP to the CallEngine. The engine translates these
 * into public {@link CallEvent}s.
 */
export type CallProviderEvent =
  | { type: 'local-stream'; stream: MediaStreamLike }
  | { type: 'remote-track'; track: RemoteTrack }
  | { type: 'remote-track-removed'; user_id: string; kind: 'audio' | 'video' }
  | { type: 'peer-joined'; user_id: string }
  | { type: 'peer-left'; user_id: string }
  | { type: 'state'; state: 'connecting' | 'connected' | 'reconnecting' | 'failed' };

export interface CallProviderContext {
  callId: string;
  /** The local user's id. */
  selfId: string;
  callType: CallType;
  /** Known peer user ids at join time (engine keeps this updated via addPeer). */
  peers: string[];
  constraints: MediaConstraints;
  /** Signaling transport. SFU providers (LiveKit/Daily) may ignore it. */
  signaling: CallSignaling;
  /** Report media/peer events back to the engine. */
  emit: (event: CallProviderEvent) => void;
}

/**
 * The media contract. Two families implement it:
 *  - {@link WebRTCCallProvider} — peer-to-peer mesh using native RTCPeerConnection,
 *    driven by the engine's CallSignaling (`handlesSignaling = false`).
 *  - SFU wrappers (LiveKit/Daily/Agora) that own their signaling internally
 *    (`handlesSignaling = true`) and scale to large rooms.
 *
 * The CallEngine code path is identical regardless of which is plugged in.
 */
export interface CallProvider {
  /** True if the provider runs its own signaling (SFU). The engine then skips
   *  forwarding offer/answer/ice to it. */
  readonly handlesSignaling: boolean;

  /** Acquire local media + open connections / join the room. */
  join(ctx: CallProviderContext): Promise<void>;

  /** A peer became known after join (e.g. accepted an invite). */
  addPeer?(userId: string): Promise<void>;

  /** Toggle local microphone. */
  setMicEnabled(enabled: boolean): Promise<void>;

  /** Toggle local camera. */
  setCameraEnabled(enabled: boolean): Promise<void>;

  /** Optional screen sharing. */
  startScreenShare?(): Promise<void>;
  stopScreenShare?(): Promise<void>;

  /** For engine-signaled providers: handle an inbound signaling message. */
  handleSignal?(message: SignalMessage): Promise<void>;

  /** Tear down media + connections. */
  leave(): Promise<void>;
}

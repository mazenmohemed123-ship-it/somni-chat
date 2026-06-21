import type { CallProvider, CallProviderContext } from './CallProvider';
import type { MediaStreamLike } from '../types/call';

/**
 * SFU provider backed by **LiveKit** (`livekit-client`). LiveKit handles the
 * hard parts — SFU routing, simulcast, TURN, adaptive bitrate, reconnection —
 * so this is a thin adapter, not a reimplementation.
 *
 * Because LiveKit owns its own signaling, `handlesSignaling = true` and the
 * CallEngine does not forward offer/answer/ice to it. You supply a `getToken`
 * callback that mints a LiveKit access token on your server (see
 * {@link createLiveKitToken}).
 *
 * Install: `npm i livekit-client` (client) and `npm i livekit-server-sdk` (token server).
 */
export interface LiveKitCallProviderOptions {
  /** LiveKit server URL, e.g. wss://your-project.livekit.cloud */
  url: string;
  /** Server-side token minting: return a JWT for (room, identity). */
  getToken: (room: string, identity: string) => Promise<string>;
  /**
   * Inject the `livekit-client` module (or a compatible fake). When omitted the
   * provider dynamically imports `livekit-client` at join time. Primarily used
   * for testing without a real LiveKit server.
   */
  livekitModule?: LiveKitModule;
  /** Room options forwarded to `new Room(...)`. */
  roomOptions?: Record<string, unknown>;
}

export class LiveKitCallProvider implements CallProvider {
  readonly handlesSignaling = true;
  private room: LiveKitRoom | null = null;
  private readonly options: LiveKitCallProviderOptions;

  constructor(options: LiveKitCallProviderOptions) {
    this.options = options;
  }

  async join(ctx: CallProviderContext): Promise<void> {
    const livekit = this.options.livekitModule ?? ((await import('livekit-client')) as unknown as LiveKitModule);
    const { Room, RoomEvent } = livekit;

    const room = new Room(this.options.roomOptions ?? { adaptiveStream: true, dynacast: true });
    this.room = room;

    room.on(RoomEvent.TrackSubscribed, (track: LiveKitTrack, _pub: unknown, participant: LiveKitParticipant) => {
      ctx.emit({
        type: 'remote-track',
        track: {
          user_id: participant.identity,
          kind: track.kind === 'video' ? 'video' : 'audio',
          stream: track.mediaStream as MediaStreamLike,
        },
      });
    });
    room.on(RoomEvent.TrackUnsubscribed, (track: LiveKitTrack, _pub: unknown, participant: LiveKitParticipant) => {
      ctx.emit({
        type: 'remote-track-removed',
        user_id: participant.identity,
        kind: track.kind === 'video' ? 'video' : 'audio',
      });
    });
    room.on(RoomEvent.ParticipantConnected, (p: LiveKitParticipant) => ctx.emit({ type: 'peer-joined', user_id: p.identity }));
    room.on(RoomEvent.ParticipantDisconnected, (p: LiveKitParticipant) => ctx.emit({ type: 'peer-left', user_id: p.identity }));
    room.on(RoomEvent.Connected, () => ctx.emit({ type: 'state', state: 'connected' }));
    room.on(RoomEvent.Reconnecting, () => ctx.emit({ type: 'state', state: 'reconnecting' }));
    room.on(RoomEvent.Disconnected, () => ctx.emit({ type: 'state', state: 'failed' }));

    const token = await this.options.getToken(ctx.callId, ctx.selfId);
    await room.connect(this.options.url, token);

    await room.localParticipant.setMicrophoneEnabled(ctx.constraints.audio);
    await room.localParticipant.setCameraEnabled(ctx.constraints.video);

    const localStream = room.localParticipant.getLocalStream?.();
    if (localStream) ctx.emit({ type: 'local-stream', stream: localStream as MediaStreamLike });
  }

  async setMicEnabled(enabled: boolean): Promise<void> {
    await this.room?.localParticipant.setMicrophoneEnabled(enabled);
  }

  async setCameraEnabled(enabled: boolean): Promise<void> {
    await this.room?.localParticipant.setCameraEnabled(enabled);
  }

  async startScreenShare(): Promise<void> {
    await this.room?.localParticipant.setScreenShareEnabled(true);
  }

  async stopScreenShare(): Promise<void> {
    await this.room?.localParticipant.setScreenShareEnabled(false);
  }

  async leave(): Promise<void> {
    await this.room?.disconnect();
    this.room = null;
  }
}

// ── Minimal structural typings for the parts of livekit-client we touch ──
export interface LiveKitModule {
  Room: new (opts?: unknown) => LiveKitRoom;
  RoomEvent: Record<string, string>;
  Track?: unknown;
}
export interface LiveKitTrack {
  kind: string;
  mediaStream?: unknown;
}
export interface LiveKitParticipant {
  identity: string;
}
export interface LiveKitRoom {
  localParticipant: {
    setMicrophoneEnabled(b: boolean): Promise<unknown>;
    setCameraEnabled(b: boolean): Promise<unknown>;
    setScreenShareEnabled(b: boolean): Promise<unknown>;
    getLocalStream?: () => unknown;
  };
  on(event: string, cb: (...args: never[]) => void): void;
  connect(url: string, token: string): Promise<void>;
  disconnect(): Promise<void>;
}

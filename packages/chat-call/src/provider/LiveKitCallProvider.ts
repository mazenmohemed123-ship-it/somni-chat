import type { CallProvider, CallProviderContext } from './CallProvider';
import type { MediaStreamLike } from '../types/call';

/**
 * SFU provider backed by **LiveKit** (`livekit-client`). LiveKit handles the
 * hard parts — SFU routing, simulcast, TURN, adaptive bitrate, reconnection —
 * so this is a thin adapter, not a reimplementation.
 *
 * Because LiveKit owns its own signaling, `handlesSignaling = true` and the
 * CallEngine does not forward offer/answer/ice to it. You supply a `getToken`
 * callback that mints a LiveKit access token on your server.
 *
 * Install: `npm i livekit-client`
 */
export interface LiveKitCallProviderOptions {
  /** LiveKit server URL, e.g. wss://your-project.livekit.cloud */
  url: string;
  /** Server-side token minting: return a JWT for (room, identity). */
  getToken: (room: string, identity: string) => Promise<string>;
}

export class LiveKitCallProvider implements CallProvider {
  readonly handlesSignaling = true;
  private room: unknown = null;
  private readonly options: LiveKitCallProviderOptions;

  constructor(options: LiveKitCallProviderOptions) {
    this.options = options;
  }

  async join(ctx: CallProviderContext): Promise<void> {
    const livekit = (await import('livekit-client')) as unknown as LiveKitModule;
    const { Room, RoomEvent, Track } = livekit;

    const room = new Room({ adaptiveStream: true, dynacast: true });
    this.room = room;

    room.on(RoomEvent.TrackSubscribed, (track, _pub, participant) => {
      ctx.emit({
        type: 'remote-track',
        track: {
          user_id: participant.identity,
          kind: track.kind === 'video' ? 'video' : 'audio',
          stream: track.mediaStream as MediaStreamLike,
        },
      });
    });
    room.on(RoomEvent.ParticipantConnected, (p) => ctx.emit({ type: 'peer-joined', user_id: p.identity }));
    room.on(RoomEvent.ParticipantDisconnected, (p) => ctx.emit({ type: 'peer-left', user_id: p.identity }));
    room.on(RoomEvent.Connected, () => ctx.emit({ type: 'state', state: 'connected' }));
    room.on(RoomEvent.Reconnecting, () => ctx.emit({ type: 'state', state: 'reconnecting' }));
    room.on(RoomEvent.Disconnected, () => ctx.emit({ type: 'state', state: 'failed' }));

    const token = await this.options.getToken(ctx.callId, ctx.selfId);
    await room.connect(this.options.url, token);

    await room.localParticipant.setMicrophoneEnabled(ctx.constraints.audio);
    await room.localParticipant.setCameraEnabled(ctx.constraints.video);

    const localStream = room.localParticipant.getLocalStream?.();
    if (localStream) ctx.emit({ type: 'local-stream', stream: localStream as MediaStreamLike });
    void Track; // referenced to keep the import meaningful across versions
  }

  async setMicEnabled(enabled: boolean): Promise<void> {
    await (this.room as LiveKitRoom | null)?.localParticipant.setMicrophoneEnabled(enabled);
  }

  async setCameraEnabled(enabled: boolean): Promise<void> {
    await (this.room as LiveKitRoom | null)?.localParticipant.setCameraEnabled(enabled);
  }

  async startScreenShare(): Promise<void> {
    await (this.room as LiveKitRoom | null)?.localParticipant.setScreenShareEnabled(true);
  }

  async stopScreenShare(): Promise<void> {
    await (this.room as LiveKitRoom | null)?.localParticipant.setScreenShareEnabled(false);
  }

  async leave(): Promise<void> {
    await (this.room as LiveKitRoom | null)?.disconnect();
    this.room = null;
  }
}

// ── Minimal structural typings for the parts of livekit-client we touch ──
interface LiveKitModule {
  Room: new (opts?: unknown) => LiveKitRoom;
  RoomEvent: Record<string, string>;
  Track: unknown;
}
interface LiveKitRoom {
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

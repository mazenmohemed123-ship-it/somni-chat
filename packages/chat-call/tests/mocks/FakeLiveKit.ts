import type { LiveKitModule, LiveKitRoom } from '../../src/provider/LiveKitCallProvider';

export const FakeRoomEvent = {
  TrackSubscribed: 'trackSubscribed',
  TrackUnsubscribed: 'trackUnsubscribed',
  ParticipantConnected: 'participantConnected',
  ParticipantDisconnected: 'participantDisconnected',
  Connected: 'connected',
  Reconnecting: 'reconnecting',
  Disconnected: 'disconnected',
} as const;

export class FakeLiveKitRoom implements LiveKitRoom {
  connectedUrl: string | null = null;
  connectedToken: string | null = null;
  micEnabled = false;
  cameraEnabled = false;
  screenShareEnabled = false;
  disconnected = false;
  readonly options: unknown;
  private readonly handlers = new Map<string, Array<(...args: never[]) => void>>();

  constructor(options?: unknown) {
    this.options = options;
  }

  localParticipant = {
    setMicrophoneEnabled: async (b: boolean) => { this.micEnabled = b; },
    setCameraEnabled: async (b: boolean) => { this.cameraEnabled = b; },
    setScreenShareEnabled: async (b: boolean) => { this.screenShareEnabled = b; },
    getLocalStream: () => ({ id: 'local-stream' }),
  };

  on(event: string, cb: (...args: never[]) => void): void {
    const list = this.handlers.get(event) ?? [];
    list.push(cb);
    this.handlers.set(event, list);
  }

  async connect(url: string, token: string): Promise<void> {
    this.connectedUrl = url;
    this.connectedToken = token;
    // Simulate the room firing Connected once joined.
    this.fire(FakeRoomEvent.Connected);
  }

  async disconnect(): Promise<void> {
    this.disconnected = true;
    this.fire(FakeRoomEvent.Disconnected);
  }

  /** Test helper: emit any RoomEvent with arbitrary args. */
  fire(event: string, ...args: unknown[]): void {
    for (const cb of this.handlers.get(event) ?? []) {
      (cb as (...a: unknown[]) => void)(...args);
    }
  }
}

export function createFakeLiveKitModule(): { module: LiveKitModule; rooms: FakeLiveKitRoom[] } {
  const rooms: FakeLiveKitRoom[] = [];
  const module: LiveKitModule = {
    Room: class extends FakeLiveKitRoom {
      constructor(opts?: unknown) {
        super(opts);
        rooms.push(this);
      }
    } as unknown as LiveKitModule['Room'],
    RoomEvent: FakeRoomEvent as unknown as Record<string, string>,
    Track: {},
  };
  return { module, rooms };
}

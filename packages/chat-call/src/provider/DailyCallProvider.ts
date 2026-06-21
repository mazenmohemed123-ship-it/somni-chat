import type { CallProvider, CallProviderContext } from './CallProvider';
import type { MediaStreamLike } from '../types/call';

/**
 * SFU provider backed by **Daily** (`@daily-co/daily-js`). Daily provides the
 * media server, global TURN, and recording; this is a thin adapter over its
 * call object. `handlesSignaling = true`.
 *
 * Install: `npm i @daily-co/daily-js`
 */
export interface DailyCallProviderOptions {
  /** Return the Daily room URL to join for a given call. */
  getRoomUrl: (callId: string) => Promise<string>;
  /** Optional meeting token for private rooms. */
  getToken?: (callId: string, identity: string) => Promise<string>;
}

export class DailyCallProvider implements CallProvider {
  readonly handlesSignaling = true;
  private callObject: DailyCall | null = null;
  private readonly options: DailyCallProviderOptions;

  constructor(options: DailyCallProviderOptions) {
    this.options = options;
  }

  async join(ctx: CallProviderContext): Promise<void> {
    const daily = (await import('@daily-co/daily-js')) as unknown as { default: DailyModule };
    const DailyIframe = daily.default;

    const call = DailyIframe.createCallObject({ audioSource: ctx.constraints.audio, videoSource: ctx.constraints.video });
    this.callObject = call;

    call.on('track-started', (ev) => {
      if (!ev.track) return;
      if (ev.participant?.local) {
        ctx.emit({ type: 'local-stream', stream: new FakeStreamFromTrack(ev.track) });
        return;
      }
      ctx.emit({
        type: 'remote-track',
        track: {
          user_id: ev.participant?.user_id ?? 'unknown',
          kind: ev.track.kind === 'video' ? 'video' : 'audio',
          stream: new FakeStreamFromTrack(ev.track),
        },
      });
    });
    call.on('participant-joined', (ev) => {
      if (ev.participant?.user_id) ctx.emit({ type: 'peer-joined', user_id: ev.participant.user_id });
    });
    call.on('participant-left', (ev) => {
      if (ev.participant?.user_id) ctx.emit({ type: 'peer-left', user_id: ev.participant.user_id });
    });
    call.on('joined-meeting', () => ctx.emit({ type: 'state', state: 'connected' }));
    call.on('error', () => ctx.emit({ type: 'state', state: 'failed' }));

    const url = await this.options.getRoomUrl(ctx.callId);
    const token = await this.options.getToken?.(ctx.callId, ctx.selfId);
    await call.join(token ? { url, token } : { url });
  }

  async setMicEnabled(enabled: boolean): Promise<void> {
    this.callObject?.setLocalAudio(enabled);
  }

  async setCameraEnabled(enabled: boolean): Promise<void> {
    this.callObject?.setLocalVideo(enabled);
  }

  async startScreenShare(): Promise<void> {
    this.callObject?.startScreenShare();
  }

  async stopScreenShare(): Promise<void> {
    this.callObject?.stopScreenShare();
  }

  async leave(): Promise<void> {
    await this.callObject?.leave();
    this.callObject?.destroy?.();
    this.callObject = null;
  }
}

/** Wraps a raw MediaStreamTrack as a MediaStreamLike for the engine. */
class FakeStreamFromTrack implements MediaStreamLike {
  id: string;
  private readonly track: { kind: string; stop(): void; enabled: boolean };
  constructor(track: { kind: string; stop(): void; enabled: boolean }) {
    this.track = track;
    this.id = `daily-${track.kind}-${Math.random().toString(36).slice(2)}`;
  }
  getTracks() {
    return [this.track];
  }
}

// ── Minimal structural typings for @daily-co/daily-js ──
interface DailyModule {
  createCallObject(opts?: unknown): DailyCall;
}
interface DailyCall {
  on(event: string, cb: (ev: DailyEvent) => void): void;
  join(opts: { url: string; token?: string }): Promise<unknown>;
  leave(): Promise<unknown>;
  destroy?(): void;
  setLocalAudio(b: boolean): void;
  setLocalVideo(b: boolean): void;
  startScreenShare(): void;
  stopScreenShare(): void;
}
interface DailyEvent {
  participant?: { local?: boolean; user_id?: string };
  track?: { kind: string; stop(): void; enabled: boolean };
}

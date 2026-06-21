import type { MediaStreamLike } from '../../src/index.ts';
import type { GetUserMediaFn } from '../../src/provider/webrtcTypes.ts';

export interface FakeTrack {
  kind: string;
  enabled: boolean;
  stopped: boolean;
  stop(): void;
}

export class FakeMediaStream implements MediaStreamLike {
  id: string;
  private tracks: FakeTrack[];
  constructor(kinds: string[]) {
    this.id = `stream-${Math.random().toString(36).slice(2)}`;
    this.tracks = kinds.map((kind) => ({
      kind,
      enabled: true,
      stopped: false,
      stop() {
        this.stopped = true;
      },
    }));
  }
  getTracks(): FakeTrack[] {
    return this.tracks;
  }
}

/** getUserMedia that returns a fake stream honoring the requested constraints. */
export function fakeGetUserMedia(): GetUserMediaFn {
  return async (constraints) => {
    const kinds: string[] = [];
    if (constraints.audio) kinds.push('audio');
    if (constraints.video) kinds.push('video');
    return new FakeMediaStream(kinds);
  };
}

import type { CallProvider, CallProviderContext, CallProviderEvent } from '../../src/provider/CallProvider.ts';
import type { SignalMessage } from '../../src/index.ts';

/**
 * A provider that does no real media. It records calls and exposes `ctx` so a
 * test can drive provider events (peer-joined, connected…) to exercise the
 * CallEngine state machine deterministically.
 */
export class MockCallProvider implements CallProvider {
  readonly handlesSignaling: boolean;
  ctx: CallProviderContext | null = null;

  joined = false;
  leftCount = 0;
  micStates: boolean[] = [];
  cameraStates: boolean[] = [];
  addedPeers: string[] = [];
  handledSignals: SignalMessage[] = [];

  constructor(handlesSignaling = false) {
    this.handlesSignaling = handlesSignaling;
  }

  async join(ctx: CallProviderContext): Promise<void> {
    this.ctx = ctx;
    this.joined = true;
  }

  async addPeer(userId: string): Promise<void> {
    this.addedPeers.push(userId);
  }

  async setMicEnabled(enabled: boolean): Promise<void> {
    this.micStates.push(enabled);
  }

  async setCameraEnabled(enabled: boolean): Promise<void> {
    this.cameraStates.push(enabled);
  }

  async handleSignal(message: SignalMessage): Promise<void> {
    this.handledSignals.push(message);
  }

  async leave(): Promise<void> {
    this.leftCount++;
    this.joined = false;
  }

  /** Test helper: push a provider event up to the engine. */
  emit(event: CallProviderEvent): void {
    this.ctx?.emit(event);
  }
}

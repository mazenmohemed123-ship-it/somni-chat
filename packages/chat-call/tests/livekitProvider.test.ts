import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { LiveKitCallProvider } from '../src/provider/LiveKitCallProvider';
import { createLiveKitToken } from '../src/provider/livekitToken';
import type { CallProviderContext, CallProviderEvent } from '../src/provider/CallProvider';
import { createFakeLiveKitModule, FakeRoomEvent } from './mocks/FakeLiveKit';
import { InMemorySignalingBus } from '../src/signaling/InMemorySignaling';

function makeContext(overrides: Partial<CallProviderContext> = {}): { ctx: CallProviderContext; events: CallProviderEvent[] } {
  const events: CallProviderEvent[] = [];
  const bus = new InMemorySignalingBus();
  const ctx: CallProviderContext = {
    callId: 'room-123',
    selfId: 'alice',
    callType: 'video',
    peers: [],
    constraints: { audio: true, video: true },
    signaling: bus.endpoint('alice'),
    emit: (e) => events.push(e),
    ...overrides,
  };
  return { ctx, events };
}

describe('LiveKitCallProvider', () => {
  test('handlesSignaling is true (SFU owns its own signaling)', () => {
    const provider = new LiveKitCallProvider({ url: 'wss://x', getToken: async () => 't' });
    assert.equal(provider.handlesSignaling, true);
  });

  test('join connects to LiveKit with minted token', async () => {
    const { module, rooms } = createFakeLiveKitModule();
    let tokenArgs: [string, string] | null = null;
    const provider = new LiveKitCallProvider({
      url: 'wss://my.livekit.cloud',
      getToken: async (room, identity) => { tokenArgs = [room, identity]; return 'jwt-token'; },
      livekitModule: module,
    });

    const { ctx } = makeContext();
    await provider.join(ctx);

    assert.equal(rooms.length, 1);
    assert.equal(rooms[0].connectedUrl, 'wss://my.livekit.cloud');
    assert.equal(rooms[0].connectedToken, 'jwt-token');
    assert.deepEqual(tokenArgs, ['room-123', 'alice']);
  });

  test('join enables mic/camera per constraints', async () => {
    const { module, rooms } = createFakeLiveKitModule();
    const provider = new LiveKitCallProvider({ url: 'wss://x', getToken: async () => 't', livekitModule: module });

    const { ctx } = makeContext({ constraints: { audio: true, video: false } });
    await provider.join(ctx);

    assert.equal(rooms[0].micEnabled, true);
    assert.equal(rooms[0].cameraEnabled, false);
  });

  test('emits connected state and local-stream on join', async () => {
    const { module } = createFakeLiveKitModule();
    const provider = new LiveKitCallProvider({ url: 'wss://x', getToken: async () => 't', livekitModule: module });

    const { ctx, events } = makeContext();
    await provider.join(ctx);

    assert.ok(events.some((e) => e.type === 'state' && e.state === 'connected'));
    assert.ok(events.some((e) => e.type === 'local-stream'));
  });

  test('remote TrackSubscribed → remote-track event', async () => {
    const { module, rooms } = createFakeLiveKitModule();
    const provider = new LiveKitCallProvider({ url: 'wss://x', getToken: async () => 't', livekitModule: module });

    const { ctx, events } = makeContext();
    await provider.join(ctx);

    rooms[0].fire(FakeRoomEvent.TrackSubscribed, { kind: 'video', mediaStream: { id: 's' } }, {}, { identity: 'bob' });

    const remote = events.find((e) => e.type === 'remote-track');
    assert.ok(remote);
    assert.equal(remote.type === 'remote-track' && remote.track.user_id, 'bob');
    assert.equal(remote.type === 'remote-track' && remote.track.kind, 'video');
  });

  test('TrackUnsubscribed → remote-track-removed event', async () => {
    const { module, rooms } = createFakeLiveKitModule();
    const provider = new LiveKitCallProvider({ url: 'wss://x', getToken: async () => 't', livekitModule: module });

    const { ctx, events } = makeContext();
    await provider.join(ctx);

    rooms[0].fire(FakeRoomEvent.TrackUnsubscribed, { kind: 'audio' }, {}, { identity: 'bob' });

    assert.ok(events.some((e) => e.type === 'remote-track-removed' && e.user_id === 'bob' && e.kind === 'audio'));
  });

  test('participant connect/disconnect → peer-joined / peer-left', async () => {
    const { module, rooms } = createFakeLiveKitModule();
    const provider = new LiveKitCallProvider({ url: 'wss://x', getToken: async () => 't', livekitModule: module });

    const { ctx, events } = makeContext();
    await provider.join(ctx);

    rooms[0].fire(FakeRoomEvent.ParticipantConnected, { identity: 'carol' });
    rooms[0].fire(FakeRoomEvent.ParticipantDisconnected, { identity: 'carol' });

    assert.ok(events.some((e) => e.type === 'peer-joined' && e.user_id === 'carol'));
    assert.ok(events.some((e) => e.type === 'peer-left' && e.user_id === 'carol'));
  });

  test('mic/camera/screenshare toggles delegate to room', async () => {
    const { module, rooms } = createFakeLiveKitModule();
    const provider = new LiveKitCallProvider({ url: 'wss://x', getToken: async () => 't', livekitModule: module });
    await provider.join(makeContext().ctx);

    await provider.setMicEnabled(false);
    assert.equal(rooms[0].micEnabled, false);
    await provider.setCameraEnabled(true);
    assert.equal(rooms[0].cameraEnabled, true);
    await provider.startScreenShare();
    assert.equal(rooms[0].screenShareEnabled, true);
    await provider.stopScreenShare();
    assert.equal(rooms[0].screenShareEnabled, false);
  });

  test('leave disconnects the room', async () => {
    const { module, rooms } = createFakeLiveKitModule();
    const provider = new LiveKitCallProvider({ url: 'wss://x', getToken: async () => 't', livekitModule: module });
    await provider.join(makeContext().ctx);

    await provider.leave();
    assert.equal(rooms[0].disconnected, true);
  });

  test('Reconnecting/Disconnected room events map to state events', async () => {
    const { module, rooms } = createFakeLiveKitModule();
    const provider = new LiveKitCallProvider({ url: 'wss://x', getToken: async () => 't', livekitModule: module });
    const { ctx, events } = makeContext();
    await provider.join(ctx);

    rooms[0].fire(FakeRoomEvent.Reconnecting);
    rooms[0].fire(FakeRoomEvent.Disconnected);

    assert.ok(events.some((e) => e.type === 'state' && e.state === 'reconnecting'));
    assert.ok(events.some((e) => e.type === 'state' && e.state === 'failed'));
  });
});

describe('createLiveKitToken', () => {
  function fakeSdk() {
    const calls: Array<Record<string, unknown>> = [];
    const module = {
      AccessToken: class {
        identity: string;
        constructor(_key: string, _secret: string, opts: { identity: string }) {
          this.identity = opts.identity;
          calls.push({ ctor: opts });
        }
        addGrant(grant: Record<string, unknown>) { calls.push({ grant }); }
        toJwt() { return `jwt-for-${this.identity}`; }
      },
    };
    return { module: module as never, calls };
  }

  test('mints a token with join grant for the room', async () => {
    const { module, calls } = fakeSdk();
    const token = await createLiveKitToken({
      apiKey: 'KEY', apiSecret: 'SECRET', room: 'room-1', identity: 'alice', serverSdkModule: module,
    });
    assert.equal(token, 'jwt-for-alice');
    const grant = calls.find((c) => c.grant)?.grant as Record<string, unknown>;
    assert.equal(grant.room, 'room-1');
    assert.equal(grant.roomJoin, true);
    assert.equal(grant.canPublish, true);
    assert.equal(grant.canSubscribe, true);
  });

  test('throws when apiKey/apiSecret missing', async () => {
    await assert.rejects(() =>
      createLiveKitToken({ apiKey: '', apiSecret: '', room: 'r', identity: 'i' })
    );
  });

  test('respects canPublish=false (subscriber-only token)', async () => {
    const { module, calls } = fakeSdk();
    await createLiveKitToken({
      apiKey: 'K', apiSecret: 'S', room: 'r', identity: 'viewer', canPublish: false, serverSdkModule: module,
    });
    const grant = calls.find((c) => c.grant)?.grant as Record<string, unknown>;
    assert.equal(grant.canPublish, false);
  });

  test('awaits Promise-returning toJwt (server-sdk v2)', async () => {
    const module = {
      AccessToken: class {
        constructor(_k: string, _s: string, _o: unknown) {}
        addGrant() {}
        toJwt() { return Promise.resolve('async-jwt'); }
      },
    } as never;
    const token = await createLiveKitToken({ apiKey: 'K', apiSecret: 'S', room: 'r', identity: 'i', serverSdkModule: module });
    assert.equal(token, 'async-jwt');
  });
});

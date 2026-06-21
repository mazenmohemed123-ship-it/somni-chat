import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WebRTCCallProvider } from '../src/index.ts';
import type { CallProviderContext, CallProviderEvent } from '../src/provider/CallProvider.ts';
import type { SignalMessage, CallSignaling } from '../src/index.ts';
import { fakePeerFactory, FakeRTCPeerConnection } from './mocks/FakeRTCPeerConnection.ts';
import { fakeGetUserMedia } from './mocks/fakeMedia.ts';

const delay = (ms = 5) => new Promise((r) => setTimeout(r, ms));

function makeCtx(selfId: string, peers: string[]) {
  const sent: SignalMessage[] = [];
  const events: CallProviderEvent[] = [];
  const signaling: CallSignaling = {
    send: (m) => { sent.push(m); },
    subscribe: () => () => undefined,
  };
  const ctx: CallProviderContext = {
    callId: 'call-1',
    selfId,
    callType: 'video',
    peers,
    constraints: { audio: true, video: true },
    signaling,
    emit: (e) => events.push(e),
  };
  return { ctx, sent, events };
}

test('join acquires local media and emits local-stream', async () => {
  const provider = new WebRTCCallProvider({ peerConnectionFactory: fakePeerFactory(), getUserMedia: fakeGetUserMedia() });
  const { ctx, events } = makeCtx('alice', []);
  await provider.join(ctx);
  assert.ok(events.some((e) => e.type === 'local-stream'));
  await provider.leave();
});

test('the lexicographically-smaller id is the offerer (glare-free)', async () => {
  // alice < bob → alice offers, bob waits.
  const aliceProv = new WebRTCCallProvider({ peerConnectionFactory: fakePeerFactory(), getUserMedia: fakeGetUserMedia() });
  const a = makeCtx('alice', ['bob']);
  await aliceProv.join(a.ctx);
  await delay();
  assert.ok(a.sent.some((m) => m.kind === 'offer' && m.to === 'bob'), 'alice sends an offer');

  const bobProv = new WebRTCCallProvider({ peerConnectionFactory: fakePeerFactory(), getUserMedia: fakeGetUserMedia() });
  const b = makeCtx('bob', ['alice']);
  await bobProv.join(b.ctx);
  await delay();
  assert.ok(!b.sent.some((m) => m.kind === 'offer'), 'bob does not offer');

  await aliceProv.leave();
  await bobProv.leave();
});

test('handling an offer produces an answer back to the sender', async () => {
  const provider = new WebRTCCallProvider({ peerConnectionFactory: fakePeerFactory(), getUserMedia: fakeGetUserMedia() });
  const { ctx, sent } = makeCtx('bob', []);
  await provider.join(ctx);
  await provider.handleSignal({ kind: 'offer', call_id: 'call-1', from: 'alice', to: 'bob', sdp: 'fake' });
  await delay();
  const answer = sent.find((m) => m.kind === 'answer');
  assert.ok(answer, 'answer sent');
  assert.equal((answer as Extract<SignalMessage, { kind: 'answer' }>).to, 'alice');
  await provider.leave();
});

test('receiving a track emits remote-track to the engine', async () => {
  const provider = new WebRTCCallProvider({ peerConnectionFactory: fakePeerFactory(), getUserMedia: fakeGetUserMedia() });
  const { ctx, events } = makeCtx('bob', []);
  await provider.join(ctx);
  await provider.handleSignal({ kind: 'offer', call_id: 'call-1', from: 'alice', to: 'bob', sdp: 'fake' });
  await delay();
  assert.ok(events.some((e) => e.type === 'remote-track'), 'remote-track emitted from ontrack');
  await provider.leave();
});

test('ICE candidates from a peer are added to the connection', async () => {
  const provider = new WebRTCCallProvider({ peerConnectionFactory: fakePeerFactory(), getUserMedia: fakeGetUserMedia() });
  const { ctx } = makeCtx('bob', []);
  await provider.join(ctx);
  // Create the peer connection by handling an offer first.
  await provider.handleSignal({ kind: 'offer', call_id: 'call-1', from: 'alice', to: 'bob', sdp: 'fake' });
  await provider.handleSignal({ kind: 'ice', call_id: 'call-1', from: 'alice', to: 'bob', candidate: { candidate: 'x' } });
  await delay();
  const pc = FakeRTCPeerConnection.instances.at(-1)!;
  assert.ok(pc.addedCandidates.length >= 1);
  await provider.leave();
});

test('messages addressed to someone else are ignored', async () => {
  const provider = new WebRTCCallProvider({ peerConnectionFactory: fakePeerFactory(), getUserMedia: fakeGetUserMedia() });
  const { ctx, sent } = makeCtx('bob', []);
  await provider.join(ctx);
  await provider.handleSignal({ kind: 'offer', call_id: 'call-1', from: 'alice', to: 'someone-else', sdp: 'fake' });
  await delay();
  assert.equal(sent.filter((m) => m.kind === 'answer').length, 0);
  await provider.leave();
});

test('leave closes peer connections and stops local tracks', async () => {
  FakeRTCPeerConnection.instances = [];
  const provider = new WebRTCCallProvider({ peerConnectionFactory: fakePeerFactory(), getUserMedia: fakeGetUserMedia() });
  const { ctx } = makeCtx('alice', ['bob']);
  await provider.join(ctx);
  await delay();
  assert.ok(provider.peerCount >= 1);
  await provider.leave();
  assert.equal(provider.peerCount, 0);
  assert.ok(FakeRTCPeerConnection.instances.every((pc) => pc.closed), 'all PCs closed');
});

test('mic/camera toggles flip local track.enabled flags', async () => {
  const provider = new WebRTCCallProvider({ peerConnectionFactory: fakePeerFactory(), getUserMedia: fakeGetUserMedia() });
  const { ctx, events } = makeCtx('alice', []);
  await provider.join(ctx);
  const local = events.find((e) => e.type === 'local-stream') as Extract<CallProviderEvent, { type: 'local-stream' }>;
  await provider.setMicEnabled(false);
  await provider.setCameraEnabled(false);
  const tracks = local.stream.getTracks();
  assert.equal(tracks.find((t) => t.kind === 'audio')?.enabled, false);
  assert.equal(tracks.find((t) => t.kind === 'video')?.enabled, false);
  await provider.leave();
});

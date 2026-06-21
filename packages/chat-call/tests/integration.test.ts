import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CallEngine, InMemorySignalingBus, WebRTCCallProvider, type CallEvent } from '../src/index.ts';
import { fakePeerFactory } from './mocks/FakeRTCPeerConnection.ts';
import { fakeGetUserMedia } from './mocks/fakeMedia.ts';

const delay = (ms = 20) => new Promise((r) => setTimeout(r, ms));

function makeEngine(bus: InMemorySignalingBus, selfId: string) {
  const provider = new WebRTCCallProvider({
    peerConnectionFactory: fakePeerFactory(),
    getUserMedia: fakeGetUserMedia(),
  });
  const engine = new CallEngine({ selfId, signaling: bus.endpoint(selfId), provider, ringTimeoutMs: 1000 });
  const log: CallEvent['type'][] = [];
  for (const t of ['call:incoming', 'call:outgoing', 'call:connected', 'call:ended', 'remote-track', 'participant:joined'] as const) {
    engine.on(t, () => log.push(t));
  }
  return { engine, provider, log };
}

test('end-to-end 1:1 video call connects over WebRTC + signaling', async () => {
  const bus = new InMemorySignalingBus();
  const alice = makeEngine(bus, 'alice'); // caller (alice < bob → offerer)
  const bob = makeEngine(bus, 'bob'); // callee

  // 1) Alice calls Bob.
  await alice.engine.start('conv-1', 'video', { peers: ['bob'] });
  await delay();

  // 2) Bob sees the incoming call and accepts.
  assert.ok(bob.log.includes('call:incoming'), 'bob received the invite');
  await bob.engine.accept();
  await delay(40); // let offer/answer/ICE settle

  // 3) Both ends reach connected with remote media.
  assert.equal(alice.engine.state, 'connected', 'alice connected');
  assert.equal(bob.engine.state, 'connected', 'bob connected');
  assert.ok(alice.log.includes('call:connected'));
  assert.ok(bob.log.includes('call:connected'));
  assert.ok(alice.log.includes('remote-track'), 'alice receives bob media');
  assert.ok(bob.log.includes('remote-track'), 'bob receives alice media');

  // 4) Both sessions show two participants.
  assert.equal(alice.engine.currentCall!.participants.length, 2);
  assert.equal(bob.engine.currentCall!.participants.length, 2);

  // 5) Alice hangs up → Bob's call ends as remote-hangup.
  await alice.engine.hangup();
  await delay();
  assert.equal(alice.engine.state, 'ended');
  assert.equal(bob.engine.state, 'ended');
  assert.equal(bob.engine.currentCall!.end_reason, 'remote-hangup');

  await alice.engine.destroy();
  await bob.engine.destroy();
});

test('callee rejecting ends the call on both sides', async () => {
  const bus = new InMemorySignalingBus();
  const alice = makeEngine(bus, 'alice');
  const bob = makeEngine(bus, 'bob');

  await alice.engine.start('conv-2', 'audio', { peers: ['bob'] });
  await delay();
  await bob.engine.reject();
  await delay();

  assert.equal(bob.engine.state, 'ended');
  assert.equal(alice.engine.state, 'ended', 'caller learns of rejection');
  assert.equal(alice.engine.currentCall!.end_reason, 'rejected');

  await alice.engine.destroy();
  await bob.engine.destroy();
});

test('audio-only call requests no video track', async () => {
  const bus = new InMemorySignalingBus();
  const alice = makeEngine(bus, 'alice');
  const bob = makeEngine(bus, 'bob');

  await alice.engine.start('conv-3', 'audio', { peers: ['bob'] });
  await delay();
  await bob.engine.accept();
  await delay(40);

  const localBob = bob.engine.currentCall!.participants.find((p) => p.is_local)!;
  assert.equal(localBob.video_enabled, false, 'audio call → camera off');
  assert.equal(localBob.audio_enabled, true);

  await alice.engine.destroy();
  await bob.engine.destroy();
});

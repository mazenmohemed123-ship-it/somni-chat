import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CallEngine, InMemorySignalingBus, type CallEvent } from '../src/index.ts';
import { MockCallProvider } from './mocks/MockCallProvider.ts';

const delay = (ms = 10) => new Promise((r) => setTimeout(r, ms));

function setup(selfId: string) {
  const bus = new InMemorySignalingBus();
  const provider = new MockCallProvider(false);
  const engine = new CallEngine({ selfId, signaling: bus.endpoint(selfId), provider, ringTimeoutMs: 50 });
  const events: CallEvent['type'][] = [];
  engine.on('call:outgoing', () => events.push('call:outgoing'));
  engine.on('call:incoming', () => events.push('call:incoming'));
  engine.on('call:connected', () => events.push('call:connected'));
  engine.on('call:ended', () => events.push('call:ended'));
  engine.on('call:state', () => events.push('call:state'));
  return { bus, provider, engine, events };
}

test('outgoing call moves to ringing and acquires media', async () => {
  const { engine, provider, events } = setup('me');
  const session = await engine.start('conv-1', 'video', { peers: ['peer'] });
  assert.equal(session.state, 'ringing');
  assert.equal(engine.state, 'ringing');
  assert.equal(provider.joined, true, 'provider.join called (local media)');
  assert.ok(events.includes('call:outgoing'));
  await engine.destroy();
});

test('incoming invite surfaces call:incoming; accept → connecting + provider.join', async () => {
  const bus = new InMemorySignalingBus();
  const provider = new MockCallProvider(false);
  const engine = new CallEngine({ selfId: 'callee', signaling: bus.endpoint('callee'), provider });

  let incoming = false;
  engine.on('call:incoming', () => { incoming = true; });

  // Simulate the caller's invite arriving.
  bus.endpoint('caller').send({
    kind: 'invite', call_id: 'c1', conversation_id: 'conv', from: 'caller', call_type: 'audio', to: 'callee',
  });
  await delay();
  assert.equal(incoming, true);
  assert.equal(engine.state, 'incoming');

  await engine.accept();
  assert.equal(engine.state, 'connecting');
  assert.equal(provider.joined, true);
  await engine.destroy();
});

test('connected state + call:connected fire when provider reports connected', async () => {
  const { engine, provider, events } = setup('me');
  await engine.start('conv', 'audio', { peers: ['peer'] });
  // Caller receives accept from peer.
  // Drive the provider to "connected".
  provider.emit({ type: 'peer-joined', user_id: 'peer' });
  provider.emit({ type: 'state', state: 'connected' });
  assert.equal(engine.state, 'connected');
  assert.equal(engine.currentCall?.connected_at !== null, true);
  assert.equal(events.filter((e) => e === 'call:connected').length, 1, 'connected emitted once');
  await engine.destroy();
});

test('call:connected is emitted at most once even on repeated connected events', async () => {
  const { engine, provider, events } = setup('me');
  await engine.start('conv', 'audio', { peers: ['peer'] });
  provider.emit({ type: 'state', state: 'connected' });
  provider.emit({ type: 'state', state: 'connected' });
  provider.emit({ type: 'state', state: 'connected' });
  assert.equal(events.filter((e) => e === 'call:connected').length, 1);
  await engine.destroy();
});

test('hangup ends the call and tears down the provider', async () => {
  const { engine, provider, events } = setup('me');
  await engine.start('conv', 'audio', { peers: ['peer'] });
  await engine.hangup();
  assert.equal(engine.state, 'ended');
  assert.equal(provider.leftCount, 1);
  assert.ok(events.includes('call:ended'));
  assert.equal(engine.currentCall?.end_reason, 'hangup');
  await engine.destroy();
});

test('remote leave ends a 1:1 call with reason remote-hangup', async () => {
  const bus = new InMemorySignalingBus();
  const provider = new MockCallProvider(false);
  const engine = new CallEngine({ selfId: 'me', signaling: bus.endpoint('me'), provider });
  let endedReason = '';
  engine.on('call:ended', (e) => { endedReason = e.payload.reason; });

  await engine.start('conv', 'audio', { peers: ['peer'] });
  // Peer accepts, then leaves.
  bus.endpoint('peer').send({ kind: 'accept', call_id: engine.currentCall!.id, from: 'peer', to: 'me' });
  await delay();
  bus.endpoint('peer').send({ kind: 'leave', call_id: engine.currentCall!.id, from: 'peer' });
  await delay();

  assert.equal(engine.state, 'ended');
  assert.equal(endedReason, 'remote-hangup');
  await engine.destroy();
});

test('reject from incoming sends reject and ends as rejected', async () => {
  const bus = new InMemorySignalingBus();
  const provider = new MockCallProvider(false);
  const engine = new CallEngine({ selfId: 'callee', signaling: bus.endpoint('callee'), provider });

  const callerInbox: string[] = [];
  bus.endpoint('caller').subscribe((m) => callerInbox.push(m.kind));

  bus.endpoint('caller').send({
    kind: 'invite', call_id: 'c1', conversation_id: 'conv', from: 'caller', call_type: 'audio', to: 'callee',
  });
  await delay();
  await engine.reject();
  await delay();

  assert.equal(engine.state, 'ended');
  assert.equal(engine.currentCall?.end_reason, 'rejected');
  assert.ok(callerInbox.includes('reject'));
  await engine.destroy();
});

test('mic/camera toggles update local participant and broadcast media-state', async () => {
  const bus = new InMemorySignalingBus();
  const provider = new MockCallProvider(false);
  const engine = new CallEngine({ selfId: 'me', signaling: bus.endpoint('me'), provider });

  const peerInbox: Extract<import('../src/index.ts').SignalMessage, { kind: 'media-state' }>[] = [];
  bus.endpoint('peer').subscribe((m) => {
    if (m.kind === 'media-state') peerInbox.push(m);
  });

  await engine.start('conv', 'video', { peers: ['peer'] });
  await engine.setMicEnabled(false);
  await engine.setCameraEnabled(false);
  await delay();

  assert.deepEqual(provider.micStates, [false]);
  assert.deepEqual(provider.cameraStates, [false]);
  const local = engine.currentCall!.participants.find((p) => p.is_local)!;
  assert.equal(local.audio_enabled, false);
  assert.equal(local.video_enabled, false);
  assert.ok(peerInbox.some((m) => m.audio_enabled === false));
  await engine.destroy();
});

test('starting a second call while one is active throws', async () => {
  const { engine } = setup('me');
  await engine.start('conv', 'audio', { peers: ['peer'] });
  await assert.rejects(() => engine.start('conv2', 'audio', { peers: ['x'] }));
  await engine.destroy();
});

test('ring timeout ends an unanswered outgoing call', async () => {
  const { engine, events } = setup('me');
  await engine.start('conv', 'audio', { peers: ['peer'] });
  await delay(80); // ringTimeoutMs = 50
  assert.equal(engine.state, 'ended');
  assert.equal(engine.currentCall?.end_reason, 'no-answer');
  assert.ok(events.includes('call:ended'));
  await engine.destroy();
});

test('inbound media-state updates a remote participant', async () => {
  const bus = new InMemorySignalingBus();
  const provider = new MockCallProvider(false);
  const engine = new CallEngine({ selfId: 'me', signaling: bus.endpoint('me'), provider });
  await engine.start('conv', 'video', { peers: ['peer'] });
  bus.endpoint('peer').send({ kind: 'accept', call_id: engine.currentCall!.id, from: 'peer', to: 'me' });
  await delay();
  bus.endpoint('peer').send({
    kind: 'media-state', call_id: engine.currentCall!.id, from: 'peer', audio_enabled: false, video_enabled: false,
  });
  await delay();
  const peer = engine.currentCall!.participants.find((p) => p.user_id === 'peer')!;
  assert.equal(peer.audio_enabled, false);
  assert.equal(peer.video_enabled, false);
  await engine.destroy();
});

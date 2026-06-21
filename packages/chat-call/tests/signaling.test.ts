import { test } from 'node:test';
import assert from 'node:assert/strict';
import { InMemorySignalingBus, TransportSignaling, type SignalMessage } from '../src/index.ts';

const delay = (ms = 5) => new Promise((r) => setTimeout(r, ms));

test('bus broadcasts untargeted messages to all other endpoints', async () => {
  const bus = new InMemorySignalingBus();
  const a = bus.endpoint('a');
  const b = bus.endpoint('b');
  const c = bus.endpoint('c');

  const received: string[] = [];
  b.subscribe(() => received.push('b'));
  c.subscribe(() => received.push('c'));

  a.send({ kind: 'leave', call_id: '1', from: 'a' });
  await delay();

  assert.deepEqual(received.sort(), ['b', 'c']);
});

test('bus delivers targeted messages only to the addressee', async () => {
  const bus = new InMemorySignalingBus();
  const a = bus.endpoint('a');
  const b = bus.endpoint('b');
  const c = bus.endpoint('c');

  let bGot = 0;
  let cGot = 0;
  b.subscribe(() => bGot++);
  c.subscribe(() => cGot++);

  a.send({ kind: 'offer', call_id: '1', from: 'a', to: 'b', sdp: 'x' });
  await delay();

  assert.equal(bGot, 1);
  assert.equal(cGot, 0);
});

test('sender never receives its own message', async () => {
  const bus = new InMemorySignalingBus();
  const a = bus.endpoint('a');
  bus.endpoint('b');
  let aGot = 0;
  a.subscribe(() => aGot++);
  a.send({ kind: 'leave', call_id: '1', from: 'a' });
  await delay();
  assert.equal(aGot, 0);
});

test('TransportSignaling namespaces by conversation and round-trips', async () => {
  const topics = new Map<string, Set<(p: unknown) => void>>();
  const transport = {
    publish: (topic: string, payload: unknown) => {
      for (const cb of topics.get(topic) ?? []) cb(payload);
    },
    subscribe: (topic: string, cb: (p: unknown) => void) => {
      if (!topics.has(topic)) topics.set(topic, new Set());
      topics.get(topic)!.add(cb);
      return () => topics.get(topic)!.delete(cb);
    },
  };

  const sig = new TransportSignaling(transport, 'conv-1');
  const got: SignalMessage[] = [];
  sig.subscribe((m) => got.push(m));
  sig.send({ kind: 'accept', call_id: 'c1', from: 'a' });

  assert.equal(got.length, 1);
  assert.equal(got[0]?.kind, 'accept');
  // Isolated from other conversations.
  assert.ok(topics.has('somni:call:conv-1'));
});

test('unsubscribe stops delivery', async () => {
  const bus = new InMemorySignalingBus();
  const a = bus.endpoint('a');
  const b = bus.endpoint('b');
  let got = 0;
  const off = b.subscribe(() => got++);
  off();
  a.send({ kind: 'leave', call_id: '1', from: 'a' });
  await delay();
  assert.equal(got, 0);
});

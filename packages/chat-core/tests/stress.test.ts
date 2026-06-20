import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createChat, type AnyMessage, type Message } from '../src/index.ts';
import { MockAdapter, flush } from './mocks/MockAdapter.ts';

test('realtime flood: 1000 mixed messages, zero duplicates', async () => {
  const adapter = new MockAdapter();
  const engine = createChat({ adapter, userId: 'me' });
  await engine.connect();

  const seenById = new Map<string, number>();
  const seenByClient = new Map<string, number>();
  const live: AnyMessage[] = [];

  engine.subscribeMessages('c1', (event) => {
    if (event.type === 'message:new') {
      const exists = live.some((m) => m.client_id === event.payload.client_id || m.id === event.payload.id);
      if (!exists) live.push(event.payload);
    } else if (event.type === 'message:updated') {
      const idx = live.findIndex((m) => m.client_id === event.payload.client_id || m.id === event.payload.id);
      if (idx >= 0) live[idx] = event.payload;
      else live.push(event.payload);
    }
    const p = event.payload as Message;
    if (event.type === 'message:new') {
      seenById.set(p.id, (seenById.get(p.id) ?? 0) + 1);
      seenByClient.set(p.client_id, (seenByClient.get(p.client_id) ?? 0) + 1);
    }
  });

  // 500 of our own optimistic sends (each echoed by the backend).
  const sends: Promise<unknown>[] = [];
  for (let i = 0; i < 500; i++) sends.push(engine.sendMessage({ conversation_id: 'c1', content: `mine-${i}` }));
  await Promise.all(sends);

  // 500 inbound messages from other users, each delivered twice (duplicate storm).
  for (let i = 0; i < 500; i++) {
    const msg = adapter.injectIncoming('c1', `other-${i}`);
    adapter.redeliver('c1', msg);
  }

  await flush();
  await flush();

  // No server id surfaced as "new" more than once.
  for (const [, count] of seenById) assert.equal(count, 1);
  // Exactly 1000 distinct messages in the live list.
  assert.equal(live.length, 1000, `expected 1000 unique messages, got ${live.length}`);
  await engine.disconnect();
});

test('subscriptions are torn down cleanly (no listener leak)', async () => {
  const adapter = new MockAdapter();
  const engine = createChat({ adapter, userId: 'me' });
  await engine.connect();

  const unsubs = Array.from({ length: 100 }, () => engine.subscribeMessages('c1', () => {}));
  unsubs.forEach((u) => u());

  // After all local subs leave, a new inbound message reaches nobody and throws nothing.
  let received = 0;
  const off = engine.subscribeMessages('c1', () => { received++; });
  adapter.injectIncoming('c1', 'hi');
  await flush();
  assert.equal(received, 1);
  off();
  await engine.disconnect();
});

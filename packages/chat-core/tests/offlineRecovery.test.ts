import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createChat, type AnyMessage } from '../src/index.ts';
import { MockAdapter, flush } from './mocks/MockAdapter.ts';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

test('messages sent while offline are queued, then flushed on recovery', async () => {
  const adapter = new MockAdapter();
  const engine = createChat({
    adapter,
    userId: 'me',
    reconnect: { baseDelayMs: 10, maxDelayMs: 20, maxAttempts: 5, jitter: 0 },
  });
  await engine.connect();

  // Go offline at the adapter level.
  adapter.online = false;

  const optimistic = await engine.sendMessage({ conversation_id: 'c1', content: 'queued-1' });
  assert.equal((optimistic as AnyMessage).status, 'pending');
  assert.equal(engine.pendingCount, 1, 'message sits in the offline queue');
  assert.equal(adapter.messages.length, 0, 'nothing persisted while offline');

  // Recover.
  adapter.online = true;
  await wait(50); // allow the drain pump (backoff-gated) to run
  await flush();

  assert.equal(engine.pendingCount, 0, 'queue drained after recovery');
  assert.equal(adapter.messages.length, 1, 'message persisted');
  assert.equal(adapter.messages[0]?.content, 'queued-1');
  await engine.disconnect();
});

test('queued messages preserve order on flush', async () => {
  const adapter = new MockAdapter();
  const engine = createChat({
    adapter,
    userId: 'me',
    reconnect: { baseDelayMs: 5, maxDelayMs: 10, maxAttempts: 5, jitter: 0 },
  });
  await engine.connect();

  adapter.online = false;
  await engine.sendMessage({ conversation_id: 'c1', content: 'A' });
  await engine.sendMessage({ conversation_id: 'c1', content: 'B' });
  await engine.sendMessage({ conversation_id: 'c1', content: 'C' });
  assert.equal(engine.pendingCount, 3);

  adapter.online = true;
  await wait(60);
  await flush();

  assert.deepEqual(adapter.messages.map((m) => m.content), ['A', 'B', 'C']);
  await engine.disconnect();
});

test('a permanently failing message is dead-lettered, not retried forever', async () => {
  const adapter = new MockAdapter();
  const engine = createChat({
    adapter,
    userId: 'me',
    offlineQueue: { enabled: true, maxRetries: 3 },
    reconnect: { baseDelayMs: 2, maxDelayMs: 4, maxAttempts: 10, jitter: 0 },
  });
  await engine.connect();

  adapter.online = false; // will never come back online
  await engine.sendMessage({ conversation_id: 'c1', content: 'doomed' });

  await wait(120); // enough cycles to exhaust retries
  await flush();

  assert.equal(engine.pendingCount, 0, 'op removed from active queue');
  const dead = engine.getDeadLetterMessages();
  assert.equal(dead.length, 1, 'op moved to dead-letter queue');
  assert.equal(dead[0]?.payload.content, 'doomed');
  await engine.disconnect();
});

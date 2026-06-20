import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OfflineQueue, type PersistentStorage } from '../src/utils/offlineQueue.ts';

function memoryStorage(): PersistentStorage & { dump: Record<string, string> } {
  const dump: Record<string, string> = {};
  return {
    dump,
    getItem: (k) => (k in dump ? dump[k] : null),
    setItem: (k, v) => { dump[k] = v; },
    removeItem: (k) => { delete dump[k]; },
  };
}

const payload = (id: string) => ({
  id,
  type: 'send_message' as const,
  payload: { conversation_id: 'c1', content: 'hi', client_id: id },
});

test('enqueue is idempotent (no duplicate client ops)', () => {
  const q = new OfflineQueue({ storage: memoryStorage() });
  q.enqueue(payload('a'));
  q.enqueue(payload('a'));
  assert.equal(q.size(), 1);
});

test('preserves FIFO order and acks from the head', () => {
  const q = new OfflineQueue({ storage: memoryStorage() });
  q.enqueue(payload('a'));
  q.enqueue(payload('b'));
  assert.equal(q.peek()?.id, 'a');
  q.ack('a');
  assert.equal(q.peek()?.id, 'b');
});

test('recordFailure applies backoff so the op is not immediately ready', () => {
  const q = new OfflineQueue({ storage: memoryStorage() });
  q.enqueue(payload('a'));
  const dead = q.recordFailure('a', 'network', () => 5000);
  assert.equal(dead, false);
  assert.equal(q.peekReady(Date.now()), undefined); // gated by backoff
  assert.notEqual(q.peekReady(Date.now() + 6000), undefined); // ready after delay
});

test('dead-letters an op after exceeding maxRetries', () => {
  const q = new OfflineQueue({ storage: memoryStorage(), maxRetries: 3 });
  q.enqueue(payload('a'));
  let dead = false;
  for (let i = 0; i < 3; i++) dead = q.recordFailure('a', 'boom', () => 0);
  assert.equal(dead, true);
  assert.equal(q.size(), 0);
  assert.equal(q.getDeadLetter().length, 1);
  assert.equal(q.getDeadLetter()[0]?.last_error, 'boom');
});

test('retryDeadLetter requeues a permanently-failed op', () => {
  const q = new OfflineQueue({ storage: memoryStorage(), maxRetries: 1 });
  q.enqueue(payload('a'));
  q.recordFailure('a', 'boom', () => 0);
  assert.equal(q.getDeadLetter().length, 1);
  assert.equal(q.retryDeadLetter('a'), true);
  assert.equal(q.size(), 1);
  assert.equal(q.getDeadLetter().length, 0);
});

test('survives a refresh: a new queue hydrates from storage', () => {
  const storage = memoryStorage();
  const q1 = new OfflineQueue({ storage });
  q1.enqueue(payload('a'));
  q1.enqueue(payload('b'));

  const q2 = new OfflineQueue({ storage }); // simulate page reload
  assert.equal(q2.size(), 2);
  assert.equal(q2.peek()?.id, 'a');
});

test('msUntilReady reflects backoff gate', () => {
  const q = new OfflineQueue({ storage: memoryStorage() });
  assert.equal(q.msUntilReady(), null);
  q.enqueue(payload('a'));
  assert.equal(q.msUntilReady(), 0);
  q.recordFailure('a', 'x', () => 1000);
  const wait = q.msUntilReady()!;
  assert.ok(wait > 0 && wait <= 1000);
});

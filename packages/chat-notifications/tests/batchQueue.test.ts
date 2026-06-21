import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { BatchQueue } from '../src/engine/BatchQueue.js';
import type { NotificationEnvelope } from '../src/types/notification.js';

function makeEnvelope(userId = 'u1', convId?: string): NotificationEnvelope {
  return {
    id: Math.random().toString(36).slice(2),
    target: { userId, token: 'tok', channel: 'fcm' },
    payload: { title: 'Hi', body: 'Hello' },
    createdAt: Date.now(),
    conversationId: convId,
  };
}

describe('BatchQueue', () => {
  test('flushAll sends pending envelopes', async () => {
    const flushed: NotificationEnvelope[][] = [];
    const queue = new BatchQueue(
      { maxBatchSize: 100, windowMs: 10_000, maxDelayMs: 20_000, collapseByConversation: false },
      async (_id, envelopes) => { flushed.push(envelopes); }
    );

    queue.enqueue(makeEnvelope('u1'));
    queue.enqueue(makeEnvelope('u2'));
    assert.equal(queue.pendingCount, 2);

    queue.flushAll();
    await new Promise((r) => setImmediate(r));
    assert.equal(queue.pendingCount, 0);
    assert.ok(flushed.length > 0);
  });

  test('auto-flushes when maxBatchSize is reached', async () => {
    const flushed: NotificationEnvelope[][] = [];
    const queue = new BatchQueue(
      { maxBatchSize: 3, windowMs: 10_000, maxDelayMs: 20_000, collapseByConversation: false },
      async (_id, envelopes) => { flushed.push(envelopes); }
    );

    queue.enqueue(makeEnvelope());
    queue.enqueue(makeEnvelope());
    queue.enqueue(makeEnvelope());
    await new Promise((r) => setImmediate(r));
    assert.ok(flushed.some((f) => f.length === 3));
  });

  test('collapses notifications for same user+conversation', async () => {
    const flushed: NotificationEnvelope[][] = [];
    const queue = new BatchQueue(
      { maxBatchSize: 100, windowMs: 50, maxDelayMs: 200, collapseByConversation: true },
      async (_id, envelopes) => { flushed.push(envelopes); }
    );

    queue.enqueue(makeEnvelope('u1', 'conv1'));
    queue.enqueue(makeEnvelope('u1', 'conv1'));
    queue.enqueue(makeEnvelope('u1', 'conv1'));
    queue.flushAll();
    await new Promise((r) => setImmediate(r));

    const batch = flushed[0];
    assert.equal(batch.length, 1);
    assert.equal(batch[0].payload.data?.['collapsed'], '2');
  });

  test('does NOT collapse different conversations', async () => {
    const flushed: NotificationEnvelope[][] = [];
    const queue = new BatchQueue(
      { maxBatchSize: 100, windowMs: 50, maxDelayMs: 200, collapseByConversation: true },
      async (_id, envelopes) => { flushed.push(envelopes); }
    );

    queue.enqueue(makeEnvelope('u1', 'conv1'));
    queue.enqueue(makeEnvelope('u1', 'conv2'));
    queue.flushAll();
    await new Promise((r) => setImmediate(r));

    const allItems = flushed.flatMap((f) => f);
    assert.equal(allItems.length, 2);
  });

  test('separate buckets per user channel', async () => {
    const flushed: NotificationEnvelope[][] = [];
    const queue = new BatchQueue(
      { maxBatchSize: 100, windowMs: 50, maxDelayMs: 200, collapseByConversation: false },
      async (_id, envelopes) => { flushed.push(envelopes); }
    );

    const e1: NotificationEnvelope = { ...makeEnvelope('u1'), target: { userId: 'u1', token: 't1', channel: 'fcm' } };
    const e2: NotificationEnvelope = { ...makeEnvelope('u1'), target: { userId: 'u1', token: 't2', channel: 'apns' } };
    queue.enqueue(e1);
    queue.enqueue(e2);
    queue.flushAll();
    await new Promise((r) => setImmediate(r));
    assert.equal(flushed.length, 2);
  });

  test('destroy cancels timers and clears buckets', () => {
    const queue = new BatchQueue(
      { maxBatchSize: 100, windowMs: 10_000, maxDelayMs: 20_000, collapseByConversation: false },
      async () => {}
    );
    queue.enqueue(makeEnvelope());
    queue.destroy();
    assert.equal(queue.pendingCount, 0);
  });
});

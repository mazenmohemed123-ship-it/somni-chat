import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { AnalyticsEngine } from '../src/engine/AnalyticsEngine.js';
import { InMemoryProvider } from '../src/providers/InMemoryProvider.js';

describe('Analytics integration', () => {
  test('full pipeline: track → aggregate → snapshot', () => {
    const provider = new InMemoryProvider();
    const engine = new AnalyticsEngine({ provider, snapshotIntervalMs: 0, pruneIntervalMs: 0 });

    const users = ['alice', 'bob', 'charlie', 'diana', 'eve'];
    const now = Date.now();

    for (const u of users) {
      engine.track({ type: 'user:active', userId: u, timestamp: now });
    }
    for (let i = 0; i < 20; i++) {
      const uid = users[i % users.length];
      const msgId = `msg-${i}`;
      engine.track({ type: 'message:sent', userId: uid, timestamp: now - 500, conversationId: 'conv-main', metadata: { messageId: msgId } });
      engine.track({ type: 'message:delivered', userId: uid, timestamp: now, conversationId: 'conv-main', metadata: { messageId: msgId } });
    }

    const snap = engine.snapshot(now);
    assert.equal(snap.dau, 5);
    assert.equal(snap.totalMessages, 20);
    assert.equal(snap.deliveryRate, 1.0);
    assert.ok(snap.avgResponseTimeMs > 0);

    // provider received all events
    assert.ok(provider.events.length > 0);
    engine.destroy();
  });

  test('1000 messages: zero duplicate DAU counts, correct delivery rate', () => {
    const engine = new AnalyticsEngine({ snapshotIntervalMs: 0, pruneIntervalMs: 0 });
    const now = Date.now();
    const userIds = Array.from({ length: 50 }, (_, i) => `user-${i}`);

    for (let i = 0; i < 1000; i++) {
      const uid = userIds[i % userIds.length];
      engine.track({ type: 'user:active', userId: uid, timestamp: now });
      engine.track({ type: 'message:sent', userId: uid, timestamp: now - 100 });
      if (i % 2 === 0) {
        engine.track({ type: 'message:delivered', userId: uid, timestamp: now });
      }
    }

    const dau = engine.getDAU();
    assert.equal(dau.activeUsers, 50); // exactly 50 unique users despite 1000 tracks

    const rates = engine.getDeliveryRates('hour', now);
    assert.equal(rates.sent, 1000);
    assert.equal(rates.delivered, 500);
    assert.equal(rates.deliveryRate, 0.5);
    engine.destroy();
  });

  test('multi-conversation stats', () => {
    const engine = new AnalyticsEngine({ snapshotIntervalMs: 0, pruneIntervalMs: 0 });
    const convs = ['conv-a', 'conv-b', 'conv-c'];

    for (let i = 0; i < 30; i++) {
      const conv = convs[i % convs.length];
      engine.track({ type: 'message:sent', userId: `u${i % 5}`, conversationId: conv });
    }

    const all = engine.getAllConversationStats();
    assert.equal(all.length, 3);
    for (const s of all) {
      assert.equal(s.messageCount, 10);
    }
    engine.destroy();
  });

  test('InMemoryProvider stores and queries events', async () => {
    const provider = new InMemoryProvider();
    const engine = new AnalyticsEngine({ provider, snapshotIntervalMs: 0, pruneIntervalMs: 0 });
    const now = Date.now();

    for (let i = 0; i < 5; i++) {
      engine.track({ type: 'message:sent', userId: 'u1', timestamp: now - 1000 });
    }

    const points = await provider.query('message:sent', 'hour', now);
    assert.equal(points.length, 5);
    engine.destroy();
  });

  test('error events tracked separately from message failures', () => {
    const engine = new AnalyticsEngine({ snapshotIntervalMs: 0, pruneIntervalMs: 0 });

    engine.track({ type: 'error', userId: 'system' });
    engine.track({ type: 'message:failed', userId: 'u1' });
    engine.track({ type: 'message:failed', userId: 'u2' });

    assert.equal(engine.getErrorCount('hour'), 3);
    const rates = engine.getDeliveryRates('hour');
    assert.equal(rates.failed, 2); // only message:failed counted here
    engine.destroy();
  });
});

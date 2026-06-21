import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { MetricAggregator } from '../src/engine/MetricAggregator.js';
import type { MetricEvent } from '../src/types/metrics.js';

function ev(type: MetricEvent['type'], userId = 'u1', extras: Partial<MetricEvent> = {}): MetricEvent {
  return { type, userId, timestamp: Date.now(), ...extras };
}

describe('MetricAggregator', () => {
  test('tracks unique users for DAU', () => {
    const agg = new MetricAggregator();
    agg.ingest(ev('user:active', 'u1'));
    agg.ingest(ev('user:active', 'u2'));
    agg.ingest(ev('user:active', 'u1')); // duplicate

    const dau = agg.getDAU();
    assert.equal(dau.activeUsers, 2);
  });

  test('delivery rate = delivered / sent', () => {
    const agg = new MetricAggregator();
    const now = Date.now();
    agg.ingest(ev('message:sent', 'u1', { timestamp: now - 1000 }));
    agg.ingest(ev('message:sent', 'u1', { timestamp: now - 500 }));
    agg.ingest(ev('message:delivered', 'u1', { timestamp: now - 200 }));

    const rates = agg.getDeliveryRates('hour', now);
    assert.equal(rates.sent, 2);
    assert.equal(rates.delivered, 1);
    assert.equal(rates.deliveryRate, 0.5);
  });

  test('response time calculated from sent→delivered delta', () => {
    const agg = new MetricAggregator();
    const now = Date.now();
    const msgId = 'msg-123';
    agg.ingest(ev('message:sent', 'u1', { timestamp: now - 500, conversationId: 'c1', metadata: { messageId: msgId } }));
    agg.ingest(ev('message:delivered', 'u1', { timestamp: now - 200, conversationId: 'c1', metadata: { messageId: msgId } }));

    const rt = agg.getResponseTime();
    assert.ok(rt.sampleCount >= 1);
    assert.ok(rt.mean > 0);
    assert.ok(rt.p50 >= 0);
  });

  test('tracks conversation message counts', () => {
    const agg = new MetricAggregator();
    agg.ingest(ev('message:sent', 'u1', { conversationId: 'c1' }));
    agg.ingest(ev('message:sent', 'u2', { conversationId: 'c1' }));
    agg.ingest(ev('message:sent', 'u3', { conversationId: 'c2' }));

    const stats = agg.getConversationStats('c1');
    assert.ok(stats);
    assert.equal(stats.messageCount, 2);

    const allStats = agg.getAllConversationStats();
    assert.equal(allStats.length, 2);
  });

  test('error count increments on message:failed', () => {
    const agg = new MetricAggregator();
    agg.ingest(ev('message:failed'));
    agg.ingest(ev('message:failed'));
    agg.ingest(ev('error'));

    assert.equal(agg.getErrorCount('hour'), 3);
  });

  test('read rate = read / delivered', () => {
    const agg = new MetricAggregator();
    const now = Date.now();
    for (let i = 0; i < 4; i++) agg.ingest(ev('message:delivered', 'u1', { timestamp: now - 1000 }));
    for (let i = 0; i < 2; i++) agg.ingest(ev('message:read', 'u1', { timestamp: now - 500 }));

    const rates = agg.getDeliveryRates('hour', now);
    assert.equal(rates.readRate, 0.5);
  });

  test('snapshot returns combined metrics', () => {
    const agg = new MetricAggregator();
    agg.ingest(ev('user:active', 'u1'));
    agg.ingest(ev('message:sent', 'u1'));

    const snap = agg.snapshot();
    assert.ok(snap.timestamp > 0);
    assert.equal(snap.dau, 1);
    assert.equal(snap.totalMessages, 1);
  });

  test('clear resets all state', () => {
    const agg = new MetricAggregator();
    agg.ingest(ev('user:active', 'u1'));
    agg.ingest(ev('message:sent', 'u1'));
    agg.clear();

    assert.equal(agg.getDAU().activeUsers, 0);
    assert.equal(agg.getDeliveryRates('hour').sent, 0);
  });

  test('percentiles computed correctly for response times', () => {
    const agg = new MetricAggregator();
    const now = Date.now();
    // Simulate 100 messages with known response times (10ms increments)
    for (let i = 1; i <= 100; i++) {
      const msgId = `msg-${i}`;
      agg.ingest(ev('message:sent', 'u1', { timestamp: now - 2000, conversationId: 'c1', metadata: { messageId: msgId } }));
      agg.ingest(ev('message:delivered', 'u1', { timestamp: now - 2000 + i * 10, conversationId: 'c1', metadata: { messageId: msgId } }));
    }
    const rt = agg.getResponseTime();
    assert.equal(rt.sampleCount, 100);
    assert.ok(rt.p50 >= 490 && rt.p50 <= 510, `p50 should be ~500ms, got ${rt.p50}`);
    assert.ok(rt.p95 >= 940 && rt.p95 <= 960, `p95 should be ~950ms, got ${rt.p95}`);
    assert.ok(rt.min <= rt.p50);
    assert.ok(rt.p50 <= rt.p99);
    assert.ok(rt.p99 <= rt.max);
  });
});

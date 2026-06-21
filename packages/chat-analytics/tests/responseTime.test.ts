import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { MetricAggregator } from '../src/engine/MetricAggregator.js';

describe('Response time tracking', () => {
  test('returns zero stats when no samples', () => {
    const agg = new MetricAggregator();
    const rt = agg.getResponseTime();
    assert.equal(rt.sampleCount, 0);
    assert.equal(rt.mean, 0);
    assert.equal(rt.p50, 0);
  });

  test('single sample gives correct stats', () => {
    const agg = new MetricAggregator();
    const now = Date.now();
    const msgId = 'msg-1';
    agg.ingest({ type: 'message:sent', userId: 'u1', timestamp: now - 1000, conversationId: 'c1', metadata: { messageId: msgId } });
    agg.ingest({ type: 'message:delivered', userId: 'u1', timestamp: now, conversationId: 'c1', metadata: { messageId: msgId } });

    const rt = agg.getResponseTime();
    assert.equal(rt.sampleCount, 1);
    assert.ok(rt.mean >= 990 && rt.mean <= 1010, `mean should be ~1000ms, got ${rt.mean}`);
    assert.equal(rt.min, rt.max);
    assert.equal(rt.p50, rt.p99);
  });

  test('p99 < max for many samples', () => {
    const agg = new MetricAggregator();
    const now = Date.now();
    // 99 fast messages + 1 slow outlier
    for (let i = 1; i <= 99; i++) {
      const id = `msg-${i}`;
      agg.ingest({ type: 'message:sent', userId: 'u1', timestamp: now - 200, conversationId: 'c', metadata: { messageId: id } });
      agg.ingest({ type: 'message:delivered', userId: 'u1', timestamp: now - 200 + 100, conversationId: 'c', metadata: { messageId: id } });
    }
    // outlier: 5000ms response time
    const outlierId = 'msg-outlier';
    agg.ingest({ type: 'message:sent', userId: 'u1', timestamp: now - 5000, conversationId: 'c', metadata: { messageId: outlierId } });
    agg.ingest({ type: 'message:delivered', userId: 'u1', timestamp: now, conversationId: 'c', metadata: { messageId: outlierId } });

    const rt = agg.getResponseTime();
    assert.equal(rt.sampleCount, 100);
    assert.ok(rt.p50 <= rt.p95, `p50 <= p95`);
    assert.ok(rt.p95 <= rt.p99, `p95 <= p99`);
    assert.ok(rt.max >= 4990, `max should capture outlier ~5000ms`);
    assert.ok(rt.p50 < 200, `p50 should be in the fast group ~100ms`);
  });

  test('unmatched delivery (no sent) does not add sample', () => {
    const agg = new MetricAggregator();
    agg.ingest({ type: 'message:delivered', userId: 'u1', timestamp: Date.now(), conversationId: 'c', metadata: { messageId: 'x' } });
    const rt = agg.getResponseTime();
    assert.equal(rt.sampleCount, 0);
  });

  test('each messageId tracked independently', () => {
    const agg = new MetricAggregator();
    const now = Date.now();
    for (let i = 1; i <= 5; i++) {
      const id = `msg-${i}`;
      agg.ingest({ type: 'message:sent', userId: 'u1', timestamp: now - i * 100, conversationId: 'c', metadata: { messageId: id } });
      agg.ingest({ type: 'message:delivered', userId: 'u1', timestamp: now, conversationId: 'c', metadata: { messageId: id } });
    }
    const rt = agg.getResponseTime();
    assert.equal(rt.sampleCount, 5);
  });
});

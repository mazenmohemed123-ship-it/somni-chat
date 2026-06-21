import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { MetricAggregator } from '../src/engine/MetricAggregator.js';

describe('Delivery rates', () => {
  test('100% delivery rate when all messages delivered', () => {
    const agg = new MetricAggregator();
    const now = Date.now();
    for (let i = 0; i < 10; i++) {
      agg.ingest({ type: 'message:sent', userId: 'u1', timestamp: now - 1000 });
      agg.ingest({ type: 'message:delivered', userId: 'u1', timestamp: now - 500 });
    }
    const rates = agg.getDeliveryRates('hour', now);
    assert.equal(rates.deliveryRate, 1.0);
  });

  test('0% delivery rate when none delivered', () => {
    const agg = new MetricAggregator();
    const now = Date.now();
    for (let i = 0; i < 5; i++) {
      agg.ingest({ type: 'message:sent', userId: 'u1', timestamp: now - 1000 });
    }
    const rates = agg.getDeliveryRates('hour', now);
    assert.equal(rates.deliveryRate, 0);
    assert.equal(rates.sent, 5);
  });

  test('deliveryRate is 0 when sent is 0', () => {
    const agg = new MetricAggregator();
    const rates = agg.getDeliveryRates('hour');
    assert.equal(rates.deliveryRate, 0);
    assert.equal(rates.readRate, 0);
  });

  test('failed messages counted separately', () => {
    const agg = new MetricAggregator();
    const now = Date.now();
    agg.ingest({ type: 'message:sent', userId: 'u1', timestamp: now - 1000 });
    agg.ingest({ type: 'message:sent', userId: 'u1', timestamp: now - 1000 });
    agg.ingest({ type: 'message:failed', userId: 'u1', timestamp: now - 500 });

    const rates = agg.getDeliveryRates('hour', now);
    assert.equal(rates.sent, 2);
    assert.equal(rates.failed, 1);
  });

  test('time window filters correctly: hour vs day', () => {
    const agg = new MetricAggregator();
    const now = Date.now();
    // 2 hours ago - outside hour window but inside day window
    agg.ingest({ type: 'message:sent', userId: 'u1', timestamp: now - 7_200_000 });
    // 30 min ago - inside both
    agg.ingest({ type: 'message:sent', userId: 'u1', timestamp: now - 1_800_000 });

    const hourRates = agg.getDeliveryRates('hour', now);
    const dayRates = agg.getDeliveryRates('day', now);
    assert.equal(hourRates.sent, 1);
    assert.equal(dayRates.sent, 2);
  });

  test('windowStart and windowEnd are correct', () => {
    const agg = new MetricAggregator();
    const now = Date.now();
    const rates = agg.getDeliveryRates('hour', now);
    assert.ok(rates.windowEnd <= now + 10);
    assert.ok(rates.windowStart <= now - 3_600_000 + 10);
  });
});

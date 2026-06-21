import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { MetricAggregator } from '../src/engine/MetricAggregator.js';

describe('DAU tracking', () => {
  test('DAU counts unique users per day', () => {
    const agg = new MetricAggregator();
    const now = Date.now();
    const todayKey = new Date(now).toISOString().slice(0, 10);

    for (const uid of ['alice', 'bob', 'charlie']) {
      agg.ingest({ type: 'user:active', userId: uid, timestamp: now });
    }
    // duplicates should not count
    agg.ingest({ type: 'user:active', userId: 'alice', timestamp: now });
    agg.ingest({ type: 'user:active', userId: 'bob', timestamp: now });

    const dau = agg.getDAU(todayKey);
    assert.equal(dau.activeUsers, 3);
    assert.equal(dau.date, todayKey);
  });

  test('message:sent counts user as active', () => {
    const agg = new MetricAggregator();
    const now = Date.now();
    const todayKey = new Date(now).toISOString().slice(0, 10);

    agg.ingest({ type: 'message:sent', userId: 'dave', timestamp: now });
    const dau = agg.getDAU(todayKey);
    assert.equal(dau.activeUsers, 1);
  });

  test('DAU for different dates stays separate', () => {
    const agg = new MetricAggregator();
    const today = Date.now();
    const yesterday = today - 86_400_000;

    agg.ingest({ type: 'user:active', userId: 'u1', timestamp: today });
    agg.ingest({ type: 'user:active', userId: 'u2', timestamp: yesterday });
    agg.ingest({ type: 'user:active', userId: 'u3', timestamp: yesterday });

    const todayKey = new Date(today).toISOString().slice(0, 10);
    const yestKey = new Date(yesterday).toISOString().slice(0, 10);

    const todayDau = agg.getDAU(todayKey);
    const yestDau = agg.getDAU(yestKey);

    assert.equal(todayDau.activeUsers, 1);
    assert.equal(yestDau.activeUsers, 2);
  });

  test('getDAU with no events returns zero', () => {
    const agg = new MetricAggregator();
    const dau = agg.getDAU('2025-01-01');
    assert.equal(dau.activeUsers, 0);
  });

  test('uniqueUsers set contains exact user ids', () => {
    const agg = new MetricAggregator();
    const now = Date.now();
    const key = new Date(now).toISOString().slice(0, 10);
    agg.ingest({ type: 'user:active', userId: 'alice', timestamp: now });
    agg.ingest({ type: 'user:active', userId: 'bob', timestamp: now });

    const dau = agg.getDAU(key);
    assert.ok(dau.uniqueUsers.has('alice'));
    assert.ok(dau.uniqueUsers.has('bob'));
    assert.equal(dau.uniqueUsers.size, 2);
  });
});

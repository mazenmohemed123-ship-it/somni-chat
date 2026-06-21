import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { TimeSeriesBuffer } from '../src/engine/TimeSeriesBuffer.js';

describe('TimeSeriesBuffer', () => {
  test('records and queries within window', () => {
    const buf = new TimeSeriesBuffer();
    const now = Date.now();
    buf.record(1, now - 30_000);
    buf.record(2, now - 10_000);
    buf.record(3, now - 5_000);

    const points = buf.query('minute', now);
    assert.equal(points.length, 3);
  });

  test('excludes entries older than window', () => {
    const buf = new TimeSeriesBuffer();
    const now = Date.now();
    buf.record(1, now - 90_000); // 1.5 min ago
    buf.record(1, now - 30_000); // 30s ago

    const points = buf.query('minute', now);
    assert.equal(points.length, 1);
  });

  test('sum aggregates values in window', () => {
    const buf = new TimeSeriesBuffer();
    const now = Date.now();
    buf.record(5, now - 10_000);
    buf.record(3, now - 20_000);
    buf.record(2, now - 90_000); // outside window

    assert.equal(buf.sum('minute', now), 8);
  });

  test('count returns number of entries in window', () => {
    const buf = new TimeSeriesBuffer();
    const now = Date.now();
    buf.record(1, now - 1000);
    buf.record(1, now - 2000);
    buf.record(1, now - 90_000); // outside

    assert.equal(buf.count('minute', now), 2);
  });

  test('pruneOlderThan removes stale entries', () => {
    const buf = new TimeSeriesBuffer();
    const now = Date.now();
    buf.record(1, now - 90_000);
    buf.record(1, now - 30_000);
    buf.record(1, now - 10_000);
    assert.equal(buf.size, 3);

    buf.pruneOlderThan('minute', now);
    assert.equal(buf.size, 2);
  });

  test('clear removes all entries', () => {
    const buf = new TimeSeriesBuffer();
    buf.record(1);
    buf.record(2);
    buf.clear();
    assert.equal(buf.size, 0);
  });

  test('evicts oldest when maxEntries exceeded', () => {
    const buf = new TimeSeriesBuffer(10);
    for (let i = 0; i < 15; i++) buf.record(1);
    assert.ok(buf.size < 15);
  });

  test('all() returns all entries', () => {
    const buf = new TimeSeriesBuffer();
    buf.record(1);
    buf.record(2);
    assert.equal(buf.all().length, 2);
  });
});

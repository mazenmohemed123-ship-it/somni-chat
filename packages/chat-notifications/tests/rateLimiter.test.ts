import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { RateLimiter } from '../src/engine/RateLimiter.js';

describe('RateLimiter', () => {
  test('allows sends under all limits', () => {
    const rl = new RateLimiter({ maxPerUserPerMinute: 10, maxPerUserPerHour: 100, maxPerUserPerDay: 500 });
    const result = rl.check('u1');
    assert.equal(result.allowed, true);
  });

  test('blocks after per-minute limit', () => {
    const rl = new RateLimiter({ maxPerUserPerMinute: 3, maxPerUserPerHour: 100, maxPerUserPerDay: 500 });
    for (let i = 0; i < 3; i++) { rl.check('u1'); rl.record('u1'); }
    const result = rl.check('u1');
    assert.equal(result.allowed, false);
    assert.equal(result.window, 'minute');
  });

  test('blocks after per-hour limit', () => {
    const rl = new RateLimiter({ maxPerUserPerMinute: 1000, maxPerUserPerHour: 3, maxPerUserPerDay: 500 });
    for (let i = 0; i < 3; i++) { rl.check('u1'); rl.record('u1'); }
    const result = rl.check('u1');
    assert.equal(result.allowed, false);
    assert.equal(result.window, 'hour');
  });

  test('blocks after per-day limit', () => {
    const rl = new RateLimiter({ maxPerUserPerMinute: 1000, maxPerUserPerHour: 1000, maxPerUserPerDay: 3 });
    for (let i = 0; i < 3; i++) { rl.check('u1'); rl.record('u1'); }
    const result = rl.check('u1');
    assert.equal(result.allowed, false);
    assert.equal(result.window, 'day');
  });

  test('separate limits per user', () => {
    const rl = new RateLimiter({ maxPerUserPerMinute: 2, maxPerUserPerHour: 100, maxPerUserPerDay: 500 });
    rl.check('u1'); rl.record('u1');
    rl.check('u1'); rl.record('u1');
    assert.equal(rl.check('u1').allowed, false);
    assert.equal(rl.check('u2').allowed, true);
  });

  test('reset clears user counters', () => {
    const rl = new RateLimiter({ maxPerUserPerMinute: 2, maxPerUserPerHour: 100, maxPerUserPerDay: 500 });
    rl.check('u1'); rl.record('u1');
    rl.check('u1'); rl.record('u1');
    assert.equal(rl.check('u1').allowed, false);
    rl.reset('u1');
    assert.equal(rl.check('u1').allowed, true);
  });

  test('clear removes all users', () => {
    const rl = new RateLimiter({ maxPerUserPerMinute: 2, maxPerUserPerHour: 100, maxPerUserPerDay: 500 });
    rl.check('u1'); rl.record('u1');
    rl.check('u1'); rl.record('u1');
    rl.clear();
    assert.equal(rl.check('u1').allowed, true);
  });

  test('getCounters returns current bucket', () => {
    const rl = new RateLimiter({ maxPerUserPerMinute: 10, maxPerUserPerHour: 100, maxPerUserPerDay: 500 });
    assert.equal(rl.getCounters('u1'), undefined);
    rl.check('u1'); rl.record('u1');
    const bucket = rl.getCounters('u1');
    assert.ok(bucket);
    assert.equal(bucket.minute.count, 1);
    assert.equal(bucket.hour.count, 1);
    assert.equal(bucket.day.count, 1);
  });
});

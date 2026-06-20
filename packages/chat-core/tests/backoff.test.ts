import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeBackoff } from '../src/utils/backoff.ts';

const cfg = { baseDelayMs: 1000, maxDelayMs: 30_000, maxAttempts: 10, jitter: 0 };

test('grows exponentially without jitter', () => {
  assert.equal(computeBackoff(1, cfg), 1000);
  assert.equal(computeBackoff(2, cfg), 2000);
  assert.equal(computeBackoff(3, cfg), 4000);
  assert.equal(computeBackoff(4, cfg), 8000);
});

test('caps at maxDelayMs', () => {
  assert.equal(computeBackoff(20, cfg), 30_000);
});

test('jitter keeps delay within ± range', () => {
  const jcfg = { ...cfg, jitter: 0.3 };
  for (let i = 0; i < 100; i++) {
    const d = computeBackoff(3, jcfg); // base 4000, ±1200
    assert.ok(d >= 2800 && d <= 5200, `delay ${d} out of jitter range`);
  }
});

test('jitter spreads values (no thundering herd)', () => {
  const jcfg = { ...cfg, jitter: 0.3 };
  const values = new Set<number>();
  for (let i = 0; i < 50; i++) values.add(computeBackoff(5, jcfg));
  assert.ok(values.size > 5, 'expected jittered delays to differ');
});

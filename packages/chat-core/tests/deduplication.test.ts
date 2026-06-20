import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DeduplicationCache } from '../src/utils/deduplication.ts';

test('tracks and detects client ids', () => {
  const cache = new DeduplicationCache();
  assert.equal(cache.hasClientId('c1'), false);
  cache.trackClientId('c1');
  assert.equal(cache.hasClientId('c1'), true);
});

test('reconcile links client_id to server_id and flags duplicates', () => {
  const cache = new DeduplicationCache();
  cache.reconcile('client-1', 'server-1');
  assert.equal(cache.getReconciledServerId('client-1'), 'server-1');
  // A redelivery of the same server message is a duplicate.
  assert.equal(cache.isDuplicate('server-1', 'client-1'), true);
});

test('isDuplicate returns true for a known server id regardless of client id', () => {
  const cache = new DeduplicationCache();
  cache.trackServerId('server-9');
  assert.equal(cache.isDuplicate('server-9', 'whatever'), true);
  assert.equal(cache.isDuplicate('server-unknown', 'whatever'), false);
});

test('is bounded under heavy load (no unbounded growth)', () => {
  const cache = new DeduplicationCache(60_000, 100);
  for (let i = 0; i < 1000; i++) cache.trackServerId(`s${i}`);
  // Oldest entries evicted; only the most recent survive.
  assert.equal(cache.hasServerId('s0'), false);
  assert.equal(cache.hasServerId('s999'), true);
});

test('clear empties everything', () => {
  const cache = new DeduplicationCache();
  cache.reconcile('c', 's');
  cache.clear();
  assert.equal(cache.hasClientId('c'), false);
  assert.equal(cache.hasServerId('s'), false);
  assert.equal(cache.getReconciledServerId('c'), undefined);
});

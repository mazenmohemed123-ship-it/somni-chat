import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { AnalyticsEngine } from '../src/engine/AnalyticsEngine.js';
import { MockAnalyticsProvider } from './mocks/MockAnalyticsProvider.js';

describe('AnalyticsEngine', () => {
  test('track emits metric:recorded event', () => {
    const engine = new AnalyticsEngine({ snapshotIntervalMs: 0, pruneIntervalMs: 0 });
    const recorded: string[] = [];
    engine.on('metric:recorded', (e) => recorded.push(e.event.type));
    engine.track({ type: 'message:sent', userId: 'u1' });
    assert.equal(recorded.length, 1);
    assert.equal(recorded[0], 'message:sent');
    engine.destroy();
  });

  test('track forwards to provider', () => {
    const provider = new MockAnalyticsProvider();
    const engine = new AnalyticsEngine({ provider, snapshotIntervalMs: 0, pruneIntervalMs: 0 });
    engine.track({ type: 'user:active', userId: 'u1' });
    assert.equal(provider.recorded.length, 1);
    engine.destroy();
  });

  test('provider error emits error event without crashing', () => {
    const provider = new MockAnalyticsProvider();
    provider.shouldThrow = true;
    const engine = new AnalyticsEngine({ provider, snapshotIntervalMs: 0, pruneIntervalMs: 0 });
    const errors: string[] = [];
    engine.on('error', (e) => errors.push(e.error));
    assert.doesNotThrow(() => engine.track({ type: 'message:sent', userId: 'u1' }));
    assert.equal(errors.length, 1);
    engine.destroy();
  });

  test('getDAU returns active user count', () => {
    const engine = new AnalyticsEngine({ snapshotIntervalMs: 0, pruneIntervalMs: 0 });
    engine.track({ type: 'user:active', userId: 'alice' });
    engine.track({ type: 'user:active', userId: 'bob' });
    engine.track({ type: 'user:active', userId: 'alice' }); // dup
    assert.equal(engine.getDAU().activeUsers, 2);
    engine.destroy();
  });

  test('getDeliveryRates calculates correctly', () => {
    const engine = new AnalyticsEngine({ snapshotIntervalMs: 0, pruneIntervalMs: 0 });
    engine.track({ type: 'message:sent', userId: 'u1' });
    engine.track({ type: 'message:sent', userId: 'u1' });
    engine.track({ type: 'message:delivered', userId: 'u1' });
    const rates = engine.getDeliveryRates('hour');
    assert.equal(rates.sent, 2);
    assert.equal(rates.delivered, 1);
    assert.equal(rates.deliveryRate, 0.5);
    engine.destroy();
  });

  test('getErrorCount tracks errors', () => {
    const engine = new AnalyticsEngine({ snapshotIntervalMs: 0, pruneIntervalMs: 0 });
    engine.track({ type: 'error', userId: 'u1' });
    engine.track({ type: 'message:failed', userId: 'u1' });
    assert.equal(engine.getErrorCount('hour'), 2);
    engine.destroy();
  });

  test('snapshot emitted periodically via snapshotIntervalMs', async () => {
    const snapshots: number[] = [];
    const engine = new AnalyticsEngine({ snapshotIntervalMs: 30, pruneIntervalMs: 0 });
    engine.on('snapshot:ready', (e) => snapshots.push(e.snapshot.timestamp));
    engine.track({ type: 'user:active', userId: 'u1' });

    await new Promise((r) => setTimeout(r, 80));
    assert.ok(snapshots.length >= 1, `Expected at least 1 snapshot, got ${snapshots.length}`);
    engine.destroy();
  });

  test('snapshot() returns current metrics', () => {
    const engine = new AnalyticsEngine({ snapshotIntervalMs: 0, pruneIntervalMs: 0 });
    engine.track({ type: 'user:active', userId: 'u1' });
    engine.track({ type: 'message:sent', userId: 'u1' });
    const snap = engine.snapshot();
    assert.equal(snap.dau, 1);
    assert.equal(snap.totalMessages, 1);
    engine.destroy();
  });

  test('destroyed engine silently drops tracks', () => {
    const engine = new AnalyticsEngine({ snapshotIntervalMs: 0, pruneIntervalMs: 0 });
    engine.destroy();
    assert.doesNotThrow(() => engine.track({ type: 'message:sent', userId: 'u1' }));
  });

  test('getAllConversationStats returns all tracked conversations', () => {
    const engine = new AnalyticsEngine({ snapshotIntervalMs: 0, pruneIntervalMs: 0 });
    engine.track({ type: 'message:sent', userId: 'u1', conversationId: 'c1' });
    engine.track({ type: 'message:sent', userId: 'u2', conversationId: 'c2' });
    const all = engine.getAllConversationStats();
    assert.equal(all.length, 2);
    engine.destroy();
  });
});

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { NotificationEngine } from '../src/engine/NotificationEngine.js';
import { MockNotificationProvider } from './mocks/MockNotificationProvider.js';
import type { NotificationTarget, NotificationPayload } from '../src/types/notification.js';

function target(userId = 'u1', channel: 'fcm' | 'apns' | 'web-push' = 'fcm'): NotificationTarget {
  return { userId, token: 'token-abc', channel };
}

function payload(body = 'Test message'): NotificationPayload {
  return { title: 'Test', body };
}

describe('NotificationEngine', () => {
  test('send queues envelope and flushes via provider', async () => {
    const provider = new MockNotificationProvider('fcm');
    const engine = new NotificationEngine({ batch: { windowMs: 50, maxDelayMs: 100 } });
    engine.registerProvider(provider);

    await engine.send(target(), payload(), { immediate: true });
    assert.equal(provider.sent.length, 1);
    assert.equal(provider.sent[0].payload.body, 'Test message');
    engine.destroy();
  });

  test('emits notification:queued and notification:sent events', async () => {
    const provider = new MockNotificationProvider('fcm');
    const engine = new NotificationEngine();
    engine.registerProvider(provider);

    const queued: string[] = [];
    const sent: string[] = [];
    engine.on('notification:queued', (e) => queued.push(e.envelope.id));
    engine.on('notification:sent', (e) => sent.push(e.envelope.id));

    await engine.send(target(), payload(), { immediate: true });
    assert.equal(queued.length, 1);
    assert.equal(sent.length, 1);
    assert.equal(queued[0], sent[0]);
    engine.destroy();
  });

  test('emits notification:failed when provider fails', async () => {
    const provider = new MockNotificationProvider('fcm');
    provider.shouldFail = true;
    const engine = new NotificationEngine();
    engine.registerProvider(provider);

    const failed: string[] = [];
    engine.on('notification:failed', (e) => failed.push(e.error));

    await engine.send(target(), payload(), { immediate: true });
    assert.equal(failed.length, 1);
    assert.equal(failed[0], 'mock-error');
    engine.destroy();
  });

  test('emits rate-limit:exceeded when limit reached', async () => {
    const provider = new MockNotificationProvider('fcm');
    const engine = new NotificationEngine({ rateLimit: { maxPerUserPerMinute: 2, maxPerUserPerHour: 100, maxPerUserPerDay: 500 } });
    engine.registerProvider(provider);

    const exceeded: string[] = [];
    engine.on('rate-limit:exceeded', (e) => exceeded.push(e.window));

    await engine.send(target('u1'), payload(), { immediate: true });
    await engine.send(target('u1'), payload(), { immediate: true });
    await engine.send(target('u1'), payload(), { immediate: true }); // should be rate-limited
    assert.ok(exceeded.length >= 1);
    assert.equal(exceeded[0], 'minute');
    engine.destroy();
  });

  test('routes to correct provider by channel', async () => {
    const fcm = new MockNotificationProvider('fcm');
    const apns = new MockNotificationProvider('apns');
    const engine = new NotificationEngine();
    engine.registerProvider(fcm);
    engine.registerProvider(apns);

    await engine.send(target('u1', 'fcm'), payload(), { immediate: true });
    await engine.send(target('u2', 'apns'), payload(), { immediate: true });

    assert.equal(fcm.sent.length, 1);
    assert.equal(apns.sent.length, 1);
    engine.destroy();
  });

  test('emits notification:failed when no provider registered', async () => {
    const engine = new NotificationEngine();
    const errors: string[] = [];
    engine.on('notification:failed', (e) => errors.push(e.error));

    await engine.send(target('u1', 'fcm'), payload(), { immediate: true });
    assert.ok(errors[0].includes('No provider'));
    engine.destroy();
  });

  test('batch: sends multiple notifications in one batch', async () => {
    const provider = new MockNotificationProvider('fcm');
    const engine = new NotificationEngine({ batch: { maxBatchSize: 100, windowMs: 50, maxDelayMs: 100, collapseByConversation: false } });
    engine.registerProvider(provider);

    const completed: string[] = [];
    engine.on('batch:completed', (e) => completed.push(e.batchId));

    // Different users so different batch buckets — use flushAll
    for (let i = 0; i < 5; i++) {
      void engine.send(target(`u${i}`), payload(`msg ${i}`));
    }
    engine.flush();
    await new Promise((r) => setTimeout(r, 50));
    assert.ok(provider.batches.length > 0 || provider.sent.length > 0);
    engine.destroy();
  });

  test('throws when destroyed', async () => {
    const engine = new NotificationEngine();
    engine.destroy();
    await assert.rejects(() => engine.send(target(), payload(), { immediate: true }));
  });

  test('sendImmediate bypasses rate limiter and returns result', async () => {
    const provider = new MockNotificationProvider('fcm');
    const engine = new NotificationEngine({ rateLimit: { maxPerUserPerMinute: 0, maxPerUserPerHour: 0, maxPerUserPerDay: 0 } });
    engine.registerProvider(provider);

    const result = await engine.sendImmediate(target(), payload());
    assert.equal(result.success, true);
    engine.destroy();
  });

  test('emits token:invalid event on FCM invalid token error', async () => {
    const provider = new MockNotificationProvider('fcm');
    provider.shouldFail = true;
    provider.failureError = 'invalid-token: deactivated';
    const engine = new NotificationEngine();
    engine.registerProvider(provider);

    const invalidTokens: string[] = [];
    engine.on('token:invalid', (e) => invalidTokens.push(e.token));

    await engine.send(target(), payload(), { immediate: true });
    assert.equal(invalidTokens.length, 1);
    engine.destroy();
  });
});

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { NotificationEngine } from '../src/engine/NotificationEngine.js';
import { MockNotificationProvider } from './mocks/MockNotificationProvider.js';

describe('Notifications integration', () => {
  test('full flow: queue → batch → provider → events', async () => {
    const fcm = new MockNotificationProvider('fcm');
    const engine = new NotificationEngine({
      batch: { maxBatchSize: 10, windowMs: 50, maxDelayMs: 100, collapseByConversation: true },
      rateLimit: { maxPerUserPerMinute: 100, maxPerUserPerHour: 1000, maxPerUserPerDay: 5000 },
    });
    engine.registerProvider(fcm);

    const events: string[] = [];
    engine.on('notification:queued', () => events.push('queued'));
    engine.on('batch:completed', () => events.push('batch:completed'));

    for (let i = 0; i < 5; i++) {
      void engine.send({ userId: `u${i}`, token: `tok${i}`, channel: 'fcm' }, { title: 'Msg', body: `Hello ${i}` });
    }
    engine.flush();
    await new Promise((r) => setTimeout(r, 100));

    assert.equal(events.filter((e) => e === 'queued').length, 5);
    assert.ok(events.includes('batch:completed'));
    assert.ok(fcm.sent.length > 0 || fcm.batches.length > 0);
    engine.destroy();
  });

  test('collapse: 10 messages in same conversation → 1 collapsed notification', async () => {
    const fcm = new MockNotificationProvider('fcm');
    const engine = new NotificationEngine({
      batch: { maxBatchSize: 100, windowMs: 50, maxDelayMs: 100, collapseByConversation: true },
      rateLimit: { maxPerUserPerMinute: 1000, maxPerUserPerHour: 10000, maxPerUserPerDay: 50000 },
    });
    engine.registerProvider(fcm);

    for (let i = 0; i < 10; i++) {
      void engine.send(
        { userId: 'alice', token: 'tok-alice', channel: 'fcm' },
        { title: 'New message', body: `Message ${i + 1}` },
        { conversationId: 'conv-123' }
      );
    }
    engine.flush();
    await new Promise((r) => setTimeout(r, 100));

    const allBatched = fcm.batches.flatMap((b) => b);
    const collapsed = allBatched.find((e) => e.conversationId === 'conv-123');
    assert.ok(collapsed);
    assert.equal(collapsed.payload.data?.['collapsed'], '9');
    engine.destroy();
  });

  test('rate limiting blocks after threshold while allowing other users', async () => {
    const fcm = new MockNotificationProvider('fcm');
    const engine = new NotificationEngine({
      rateLimit: { maxPerUserPerMinute: 3, maxPerUserPerHour: 100, maxPerUserPerDay: 500 },
    });
    engine.registerProvider(fcm);

    const exceeded: string[] = [];
    engine.on('rate-limit:exceeded', (e) => exceeded.push(e.userId));

    for (let i = 0; i < 5; i++) {
      await engine.send({ userId: 'alice', token: 'tok', channel: 'fcm' }, { title: 'T', body: 'B' }, { immediate: true });
    }
    for (let i = 0; i < 2; i++) {
      await engine.send({ userId: 'bob', token: 'tok2', channel: 'fcm' }, { title: 'T', body: 'B' }, { immediate: true });
    }

    assert.ok(exceeded.every((u) => u === 'alice'));
    assert.equal(fcm.sent.filter((e) => e.target.userId === 'bob').length, 2);
    engine.destroy();
  });

  test('multi-channel: fcm + apns + web-push all receive notifications', async () => {
    const fcm = new MockNotificationProvider('fcm');
    const apns = new MockNotificationProvider('apns');
    const webPush = new MockNotificationProvider('web-push');
    const engine = new NotificationEngine();
    engine.registerProvider(fcm);
    engine.registerProvider(apns);
    engine.registerProvider(webPush);

    await engine.send({ userId: 'u1', token: 'tok', channel: 'fcm' }, { title: 'T', body: 'B' }, { immediate: true });
    await engine.send({ userId: 'u1', token: 'tok', channel: 'apns' }, { title: 'T', body: 'B' }, { immediate: true });
    await engine.send({ userId: 'u1', token: 'tok', channel: 'web-push' }, { title: 'T', body: 'B' }, { immediate: true });

    assert.equal(fcm.sent.length, 1);
    assert.equal(apns.sent.length, 1);
    assert.equal(webPush.sent.length, 1);
    engine.destroy();
  });
});

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { WebPushProvider } from '../src/providers/WebPushProvider.js';
import type { WebPushClient, WebPushSubscription } from '../src/providers/WebPushProvider.js';
import type { NotificationEnvelope } from '../src/types/notification.js';

const fakeSubscription: WebPushSubscription = {
  endpoint: 'https://fcm.googleapis.com/fcm/send/abc123',
  keys: { p256dh: 'key123', auth: 'auth123' },
};

function makeClient(statusCode = 201): WebPushClient {
  return {
    async sendNotification(_sub, _payload, _opts) {
      return { statusCode };
    },
  };
}

function makeEnvelope(id = 'e1', extra: Partial<NotificationEnvelope['payload']> = {}): NotificationEnvelope {
  return {
    id,
    target: { userId: 'u1', token: JSON.stringify(fakeSubscription), channel: 'web-push' },
    payload: { title: 'Hello', body: 'World', ...extra },
    createdAt: Date.now(),
  };
}

describe('WebPushProvider', () => {
  test('send succeeds for 201 response', async () => {
    const provider = new WebPushProvider({ client: makeClient(201) });
    const result = await provider.send(makeEnvelope());
    assert.equal(result.success, true);
  });

  test('send succeeds for 200 response', async () => {
    const provider = new WebPushProvider({ client: makeClient(200) });
    const result = await provider.send(makeEnvelope());
    assert.equal(result.success, true);
  });

  test('send returns invalid-token on 410 Gone', async () => {
    const provider = new WebPushProvider({ client: makeClient(410) });
    const result = await provider.send(makeEnvelope());
    assert.equal(result.success, false);
    assert.ok(result.error?.includes('invalid-token'));
  });

  test('send returns invalid-token on 404 Not Found', async () => {
    const provider = new WebPushProvider({ client: makeClient(404) });
    const result = await provider.send(makeEnvelope());
    assert.equal(result.success, false);
    assert.ok(result.error?.includes('invalid-token'));
  });

  test('send returns failure on 400 Bad Request', async () => {
    const provider = new WebPushProvider({ client: makeClient(400) });
    const result = await provider.send(makeEnvelope());
    assert.equal(result.success, false);
    assert.ok(result.error?.includes('HTTP 400'));
  });

  test('send handles client throw', async () => {
    const client: WebPushClient = {
      async sendNotification() { throw new Error('network error'); },
    };
    const provider = new WebPushProvider({ client });
    const result = await provider.send(makeEnvelope());
    assert.equal(result.success, false);
    assert.ok(result.error?.includes('network error'));
  });

  test('send returns failure for invalid subscription JSON', async () => {
    const provider = new WebPushProvider({ client: makeClient() });
    const envelope: NotificationEnvelope = {
      ...makeEnvelope(),
      target: { userId: 'u1', token: 'not-valid-json', channel: 'web-push' },
    };
    const result = await provider.send(envelope);
    assert.equal(result.success, false);
    assert.ok(result.error?.includes('invalid-token'));
  });

  test('sendBatch aggregates results correctly', async () => {
    let callCount = 0;
    const client: WebPushClient = {
      async sendNotification() {
        callCount++;
        return { statusCode: callCount === 2 ? 410 : 201 };
      },
    };
    const provider = new WebPushProvider({ client });
    const batch = await provider.sendBatch(['e1', 'e2', 'e3'].map(makeEnvelope));
    assert.equal(batch.sent, 2);
    assert.equal(batch.failed, 1);
  });

  test('validateToken accepts valid subscription JSON', () => {
    const provider = new WebPushProvider({ client: makeClient() });
    assert.equal(provider.validateToken(JSON.stringify(fakeSubscription)), true);
    assert.equal(provider.validateToken('bad json'), false);
    assert.equal(provider.validateToken(JSON.stringify({ endpoint: 'x' })), false);
  });

  test('accepts custom parseSubscription', async () => {
    const received: string[] = [];
    const provider = new WebPushProvider({
      client: makeClient(),
      parseSubscription: (token) => { received.push(token); return fakeSubscription; },
    });
    await provider.send(makeEnvelope());
    assert.ok(received.length > 0);
  });
});

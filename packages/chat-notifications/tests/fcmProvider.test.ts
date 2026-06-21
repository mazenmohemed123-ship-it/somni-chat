import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { FcmProvider } from '../src/providers/FcmProvider.js';
import type { FcmHttpClient, FcmMessage, FcmMulticastResponse } from '../src/providers/FcmProvider.js';
import type { NotificationEnvelope } from '../src/types/notification.js';

function makeClient(overrides: Partial<FcmHttpClient> = {}): FcmHttpClient {
  return {
    async send(_token, _msg) { return {}; },
    async sendMulticast(tokens, _msg) {
      return {
        successCount: tokens.length,
        failureCount: 0,
        responses: tokens.map(() => ({ success: true, messageId: 'id' })),
      };
    },
    ...overrides,
  };
}

function makeEnvelope(id = 'e1'): NotificationEnvelope {
  return {
    id,
    target: { userId: 'u1', token: 'fcm-token-xxx', channel: 'fcm' },
    payload: { title: 'New message', body: 'Hello there', priority: 'high', ttlSeconds: 3600 },
    createdAt: Date.now(),
  };
}

describe('FcmProvider', () => {
  test('send returns success on clean response', async () => {
    const provider = new FcmProvider({ httpClient: makeClient() });
    const result = await provider.send(makeEnvelope());
    assert.equal(result.success, true);
    assert.equal(result.notificationId, 'e1');
  });

  test('send returns failure when client returns error', async () => {
    const client = makeClient({
      async send() { return { error: { status: 'NOT_FOUND', message: 'token not found' } }; },
    });
    const provider = new FcmProvider({ httpClient: client });
    const result = await provider.send(makeEnvelope());
    assert.equal(result.success, false);
    assert.ok(result.error?.includes('NOT_FOUND'));
  });

  test('send returns failure when client throws', async () => {
    const client = makeClient({
      async send() { throw new Error('network timeout'); },
    });
    const provider = new FcmProvider({ httpClient: client });
    const result = await provider.send(makeEnvelope());
    assert.equal(result.success, false);
    assert.ok(result.error?.includes('network timeout'));
  });

  test('sendBatch reports correct success/failure counts', async () => {
    const client = makeClient({
      async sendMulticast(tokens) {
        return {
          successCount: 2,
          failureCount: 1,
          responses: [
            { success: true, messageId: 'id1' },
            { success: false, error: { code: 'INVALID', message: 'bad token' } },
            { success: true, messageId: 'id3' },
          ],
        } as FcmMulticastResponse;
      },
    });
    const provider = new FcmProvider({ httpClient: client });
    const envelopes = ['e1', 'e2', 'e3'].map(makeEnvelope);
    const batch = await provider.sendBatch(envelopes);
    assert.equal(batch.sent, 2);
    assert.equal(batch.failed, 1);
    assert.equal(batch.results.length, 3);
    assert.equal(batch.results[1].success, false);
  });

  test('sendBatch handles client throw gracefully', async () => {
    const client = makeClient({
      async sendMulticast() { throw new Error('fcm down'); },
    });
    const provider = new FcmProvider({ httpClient: client });
    const batch = await provider.sendBatch([makeEnvelope()]);
    assert.equal(batch.sent, 0);
    assert.equal(batch.failed, 1);
    assert.ok(batch.results[0].error?.includes('fcm down'));
  });

  test('validateToken rejects short tokens', () => {
    const provider = new FcmProvider({ httpClient: makeClient() });
    assert.equal(provider.validateToken('short'), false);
    assert.equal(provider.validateToken('a'.repeat(21)), true);
  });
});

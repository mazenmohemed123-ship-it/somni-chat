import type { NotificationProvider } from '../../src/types/provider.js';
import type { NotificationEnvelope, NotificationResult, BatchResult } from '../../src/types/notification.js';
import { generateId } from '../../src/utils/uuid.js';

export class MockNotificationProvider implements NotificationProvider {
  readonly channel: string;
  sent: NotificationEnvelope[] = [];
  batches: NotificationEnvelope[][] = [];
  shouldFail = false;
  failureError = 'mock-error';
  latencyMs = 0;

  constructor(channel = 'fcm') {
    this.channel = channel;
  }

  async send(envelope: NotificationEnvelope): Promise<NotificationResult> {
    if (this.latencyMs > 0) await new Promise((r) => setTimeout(r, this.latencyMs));
    if (this.shouldFail) {
      return { notificationId: envelope.id, success: false, error: this.failureError };
    }
    this.sent.push(envelope);
    return { notificationId: envelope.id, success: true };
  }

  async sendBatch(envelopes: NotificationEnvelope[]): Promise<BatchResult> {
    if (this.latencyMs > 0) await new Promise((r) => setTimeout(r, this.latencyMs));
    this.batches.push([...envelopes]);
    if (this.shouldFail) {
      return {
        batchId: generateId(),
        sent: 0,
        failed: envelopes.length,
        results: envelopes.map((e) => ({ notificationId: e.id, success: false, error: this.failureError })),
      };
    }
    envelopes.forEach((e) => this.sent.push(e));
    return {
      batchId: generateId(),
      sent: envelopes.length,
      failed: 0,
      results: envelopes.map((e) => ({ notificationId: e.id, success: true })),
    };
  }

  validateToken(token: string): boolean {
    return token.length > 0;
  }

  reset(): void {
    this.sent = [];
    this.batches = [];
    this.shouldFail = false;
  }
}

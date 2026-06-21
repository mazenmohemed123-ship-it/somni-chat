import type { NotificationEnvelope, NotificationResult, BatchResult } from './notification.js';

export interface NotificationProvider {
  readonly channel: string;
  send(envelope: NotificationEnvelope): Promise<NotificationResult>;
  sendBatch(envelopes: NotificationEnvelope[]): Promise<BatchResult>;
  validateToken?(token: string): boolean;
}

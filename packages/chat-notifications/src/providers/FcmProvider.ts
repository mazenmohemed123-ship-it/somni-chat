import type { NotificationProvider } from '../types/provider.js';
import type { NotificationEnvelope, NotificationResult, BatchResult } from '../types/notification.js';
import { generateId } from '../utils/uuid.js';

export interface FcmHttpClient {
  send(token: string, payload: FcmMessage): Promise<FcmResponse>;
  sendMulticast(tokens: string[], payload: FcmMessage): Promise<FcmMulticastResponse>;
}

export interface FcmMessage {
  notification?: { title: string; body: string; image?: string };
  data?: Record<string, string>;
  android?: { priority?: 'normal' | 'high'; ttl?: string; collapseKey?: string };
  token?: string;
}

export interface FcmResponse {
  name?: string;
  error?: { status: string; message: string };
}

export interface FcmMulticastResponse {
  successCount: number;
  failureCount: number;
  responses: Array<{ success: boolean; messageId?: string; error?: { code: string; message: string } }>;
}

export interface FcmProviderConfig {
  httpClient: FcmHttpClient;
}

export class FcmProvider implements NotificationProvider {
  readonly channel = 'fcm';
  private readonly httpClient: FcmHttpClient;

  constructor(config: FcmProviderConfig) {
    this.httpClient = config.httpClient;
  }

  async send(envelope: NotificationEnvelope): Promise<NotificationResult> {
    const message = this.buildMessage(envelope);
    try {
      const response = await this.httpClient.send(envelope.target.token, message);
      if (response.error) {
        return {
          notificationId: envelope.id,
          success: false,
          error: `${response.error.status}: ${response.error.message}`,
        };
      }
      return { notificationId: envelope.id, success: true };
    } catch (err) {
      return {
        notificationId: envelope.id,
        success: false,
        error: err instanceof Error ? err.message : 'unknown',
      };
    }
  }

  async sendBatch(envelopes: NotificationEnvelope[]): Promise<BatchResult> {
    const batchId = generateId();
    const tokens = envelopes.map((e) => e.target.token);
    const message = this.buildMessage(envelopes[0]);

    try {
      const response = await this.httpClient.sendMulticast(tokens, message);
      const results: NotificationResult[] = envelopes.map((e, i) => {
        const r = response.responses[i];
        if (r?.success) return { notificationId: e.id, success: true };
        return {
          notificationId: e.id,
          success: false,
          error: r?.error ? `${r.error.code}: ${r.error.message}` : 'unknown',
        };
      });
      return {
        batchId,
        sent: response.successCount,
        failed: response.failureCount,
        results,
      };
    } catch (err) {
      const error = err instanceof Error ? err.message : 'unknown';
      return {
        batchId,
        sent: 0,
        failed: envelopes.length,
        results: envelopes.map((e) => ({ notificationId: e.id, success: false, error })),
      };
    }
  }

  validateToken(token: string): boolean {
    return typeof token === 'string' && token.length > 20;
  }

  private buildMessage(envelope: NotificationEnvelope): FcmMessage {
    const p = envelope.payload;
    const msg: FcmMessage = {
      notification: { title: p.title, body: p.body, ...(p.imageUrl ? { image: p.imageUrl } : {}) },
      data: { ...(p.data ?? {}), notificationId: envelope.id },
      android: {
        priority: p.priority ?? 'high',
        ...(p.ttlSeconds ? { ttl: `${p.ttlSeconds}s` } : {}),
        ...(p.collapseKey ? { collapseKey: p.collapseKey } : {}),
      },
    };
    return msg;
  }
}

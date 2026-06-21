import type { NotificationProvider } from '../types/provider.js';
import type { NotificationEnvelope, NotificationResult, BatchResult } from '../types/notification.js';
import { generateId } from '../utils/uuid.js';

export interface ApnsHttpClient {
  push(deviceToken: string, payload: ApnsPayload, headers: ApnsHeaders): Promise<ApnsResponse>;
}

export interface ApnsPayload {
  aps: {
    alert?: { title: string; body: string };
    badge?: number;
    sound?: string | { critical?: number; name?: string; volume?: number };
    category?: string;
    'content-available'?: 1;
    'mutable-content'?: 1;
  };
  [key: string]: unknown;
}

export interface ApnsHeaders {
  'apns-priority'?: '5' | '10';
  'apns-expiration'?: string;
  'apns-collapse-id'?: string;
  'apns-topic'?: string;
}

export interface ApnsResponse {
  apnsId?: string;
  error?: string;
  statusCode?: number;
}

export interface ApnsProviderConfig {
  httpClient: ApnsHttpClient;
  bundleId?: string;
}

export class ApnsProvider implements NotificationProvider {
  readonly channel = 'apns';
  private readonly httpClient: ApnsHttpClient;
  private readonly bundleId: string | undefined;

  constructor(config: ApnsProviderConfig) {
    this.httpClient = config.httpClient;
    this.bundleId = config.bundleId;
  }

  async send(envelope: NotificationEnvelope): Promise<NotificationResult> {
    const { payload: apnsPayload, headers } = this.buildPayload(envelope);
    try {
      const response = await this.httpClient.push(envelope.target.token, apnsPayload, headers);
      if (response.error) {
        return {
          notificationId: envelope.id,
          success: false,
          error: response.error,
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
    const results = await Promise.allSettled(envelopes.map((e) => this.send(e)));
    let sent = 0;
    let failed = 0;
    const notifResults: NotificationResult[] = results.map((r, i) => {
      if (r.status === 'fulfilled') {
        if (r.value.success) { sent++; } else { failed++; }
        return r.value;
      }
      failed++;
      return {
        notificationId: envelopes[i].id,
        success: false,
        error: r.reason instanceof Error ? r.reason.message : 'unknown',
      };
    });
    return { batchId, sent, failed, results: notifResults };
  }

  validateToken(token: string): boolean {
    return /^[0-9a-f]{64}$/i.test(token);
  }

  private buildPayload(envelope: NotificationEnvelope): { payload: ApnsPayload; headers: ApnsHeaders } {
    const p = envelope.payload;
    const aps: ApnsPayload['aps'] = {
      alert: { title: p.title, body: p.body },
      ...(p.badge !== undefined ? { badge: p.badge } : {}),
      ...(p.sound !== undefined
        ? { sound: p.sound === true ? 'default' : p.sound === false ? undefined : p.sound }
        : {}),
      ...(p.category ? { category: p.category } : {}),
    };

    const payload: ApnsPayload = {
      aps,
      notificationId: envelope.id,
      ...(p.data ?? {}),
    };

    const headers: ApnsHeaders = {
      'apns-priority': p.priority === 'normal' ? '5' : '10',
      ...(p.ttlSeconds ? { 'apns-expiration': String(Math.floor(Date.now() / 1000) + p.ttlSeconds) } : {}),
      ...(p.collapseKey ? { 'apns-collapse-id': p.collapseKey } : {}),
      ...(this.bundleId ? { 'apns-topic': this.bundleId } : {}),
    };

    return { payload, headers };
  }
}

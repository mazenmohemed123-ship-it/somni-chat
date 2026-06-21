import type { NotificationProvider } from '../types/provider.js';
import type { NotificationEnvelope, NotificationResult, BatchResult } from '../types/notification.js';
import { generateId } from '../utils/uuid.js';

export interface WebPushSubscription {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export interface WebPushClient {
  sendNotification(
    subscription: WebPushSubscription,
    payload: string,
    options?: WebPushOptions
  ): Promise<WebPushSendResult>;
}

export interface WebPushOptions {
  TTL?: number;
  urgency?: 'very-low' | 'low' | 'normal' | 'high';
  topic?: string;
}

export interface WebPushSendResult {
  statusCode: number;
  body?: string;
}

export interface WebPushProviderConfig {
  client: WebPushClient;
  parseSubscription?: (token: string) => WebPushSubscription;
}

function defaultParseSubscription(token: string): WebPushSubscription {
  return JSON.parse(token) as WebPushSubscription;
}

export class WebPushProvider implements NotificationProvider {
  readonly channel = 'web-push';
  private readonly client: WebPushClient;
  private readonly parseSubscription: (token: string) => WebPushSubscription;

  constructor(config: WebPushProviderConfig) {
    this.client = config.client;
    this.parseSubscription = config.parseSubscription ?? defaultParseSubscription;
  }

  async send(envelope: NotificationEnvelope): Promise<NotificationResult> {
    let subscription: WebPushSubscription;
    try {
      subscription = this.parseSubscription(envelope.target.token);
    } catch {
      return { notificationId: envelope.id, success: false, error: 'invalid-token: bad subscription JSON' };
    }

    const body = JSON.stringify({
      title: envelope.payload.title,
      body: envelope.payload.body,
      icon: envelope.payload.icon,
      badge: envelope.payload.badge,
      image: envelope.payload.imageUrl,
      data: { ...(envelope.payload.data ?? {}), notificationId: envelope.id },
      actions: envelope.payload.clickAction ? [{ action: 'open', title: 'Open' }] : undefined,
    });

    try {
      const result = await this.client.sendNotification(subscription, body, {
        TTL: envelope.payload.ttlSeconds,
        urgency: envelope.payload.priority === 'high' ? 'high' : 'normal',
        topic: envelope.payload.collapseKey,
      });

      if (result.statusCode >= 400) {
        const isInvalid = result.statusCode === 410 || result.statusCode === 404;
        return {
          notificationId: envelope.id,
          success: false,
          error: isInvalid ? 'invalid-token: subscription expired' : `HTTP ${result.statusCode}`,
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
    try {
      const sub = JSON.parse(token) as Partial<WebPushSubscription>;
      return typeof sub.endpoint === 'string' && typeof sub.keys?.p256dh === 'string';
    } catch {
      return false;
    }
  }
}

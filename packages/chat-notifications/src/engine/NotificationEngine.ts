import type { NotificationEnvelope, NotificationPayload, NotificationTarget, BatchConfig, RateLimitConfig, BatchResult, NotificationResult } from '../types/notification.js';
import type { NotificationProvider } from '../types/provider.js';
import type { NotificationEvent } from '../types/events.js';
import { DEFAULT_BATCH_CONFIG, DEFAULT_RATE_LIMIT } from '../types/notification.js';
import { BatchQueue } from './BatchQueue.js';
import { RateLimiter } from './RateLimiter.js';
import { NotificationEmitter } from './NotificationEmitter.js';
import { generateId } from '../utils/uuid.js';

export interface NotificationEngineConfig {
  batch?: Partial<BatchConfig>;
  rateLimit?: Partial<RateLimitConfig>;
}

export class NotificationEngine {
  private readonly providers: Map<string, NotificationProvider> = new Map();
  private readonly emitter: NotificationEmitter;
  private readonly batchQueue: BatchQueue;
  private readonly rateLimiter: RateLimiter;
  private destroyed = false;

  constructor(config: NotificationEngineConfig = {}) {
    this.emitter = new NotificationEmitter();

    const batchConfig: BatchConfig = { ...DEFAULT_BATCH_CONFIG, ...(config.batch ?? {}) };
    const rateLimitConfig: RateLimitConfig = { ...DEFAULT_RATE_LIMIT, ...(config.rateLimit ?? {}) };

    this.rateLimiter = new RateLimiter(rateLimitConfig);
    this.batchQueue = new BatchQueue(batchConfig, (batchId, envelopes) =>
      this.dispatchBatch(batchId, envelopes)
    );
  }

  registerProvider(provider: NotificationProvider): this {
    this.providers.set(provider.channel, provider);
    return this;
  }

  on<T extends NotificationEvent>(type: T['type'], listener: (e: T) => void): () => void {
    return this.emitter.on(type, listener);
  }

  async send(
    target: NotificationTarget,
    payload: NotificationPayload,
    opts: { conversationId?: string; senderId?: string; immediate?: boolean } = {}
  ): Promise<string> {
    if (this.destroyed) throw new Error('NotificationEngine is destroyed');

    const { allowed, window } = this.rateLimiter.check(target.userId);
    if (!allowed) {
      this.emitter.emit({ type: 'rate-limit:exceeded', userId: target.userId, window: window! });
      return '';
    }

    const envelope: NotificationEnvelope = {
      id: generateId(),
      target,
      payload,
      createdAt: Date.now(),
      conversationId: opts.conversationId,
      senderId: opts.senderId,
    };

    this.rateLimiter.record(target.userId);
    this.emitter.emit({ type: 'notification:queued', envelope });

    if (opts.immediate) {
      await this.dispatchSingle(envelope);
    } else {
      this.batchQueue.enqueue(envelope);
    }

    return envelope.id;
  }

  async sendImmediate(
    target: NotificationTarget,
    payload: NotificationPayload
  ): Promise<NotificationResult> {
    const envelope: NotificationEnvelope = {
      id: generateId(),
      target,
      payload,
      createdAt: Date.now(),
    };
    return this.dispatchSingle(envelope);
  }

  flush(): void {
    this.batchQueue.flushAll();
  }

  get pendingCount(): number {
    return this.batchQueue.pendingCount;
  }

  destroy(): void {
    this.destroyed = true;
    this.batchQueue.destroy();
    this.emitter.removeAllListeners();
  }

  private async dispatchSingle(envelope: NotificationEnvelope): Promise<NotificationResult> {
    const provider = this.resolveProvider(envelope.target.channel);
    if (!provider) {
      const result: NotificationResult = {
        notificationId: envelope.id,
        success: false,
        error: `No provider registered for channel: ${envelope.target.channel}`,
      };
      this.emitter.emit({ type: 'notification:failed', envelope, error: result.error! });
      return result;
    }

    try {
      const result = await provider.send(envelope);
      if (result.success) {
        this.emitter.emit({ type: 'notification:sent', envelope, result });
      } else {
        if (result.error?.includes('invalid-token') || result.error?.includes('NotRegistered')) {
          this.emitter.emit({
            type: 'token:invalid',
            userId: envelope.target.userId,
            token: envelope.target.token,
            channel: envelope.target.channel,
          });
        }
        this.emitter.emit({ type: 'notification:failed', envelope, error: result.error ?? 'unknown' });
      }
      return result;
    } catch (err) {
      const error = err instanceof Error ? err.message : 'unknown';
      this.emitter.emit({ type: 'notification:failed', envelope, error });
      return { notificationId: envelope.id, success: false, error };
    }
  }

  private async dispatchBatch(batchId: string, envelopes: NotificationEnvelope[]): Promise<void> {
    this.emitter.emit({ type: 'batch:started', batchId, count: envelopes.length });

    const byChannel = new Map<string, NotificationEnvelope[]>();
    for (const e of envelopes) {
      const ch = e.target.channel === 'all' ? 'fcm' : e.target.channel;
      const list = byChannel.get(ch) ?? [];
      list.push(e);
      byChannel.set(ch, list);
    }

    let totalSent = 0;
    let totalFailed = 0;
    const allResults: NotificationResult[] = [];

    for (const [channel, group] of byChannel) {
      const provider = this.providers.get(channel);
      if (!provider) {
        for (const e of group) {
          totalFailed++;
          allResults.push({ notificationId: e.id, success: false, error: `No provider: ${channel}` });
        }
        continue;
      }

      try {
        const batchResult = await provider.sendBatch(group);
        totalSent += batchResult.sent;
        totalFailed += batchResult.failed;
        allResults.push(...batchResult.results);

        for (const res of batchResult.results) {
          const envelope = group.find((e) => e.id === res.notificationId);
          if (!envelope) continue;
          if (res.success) {
            this.emitter.emit({ type: 'notification:sent', envelope, result: res });
          } else {
            this.emitter.emit({ type: 'notification:failed', envelope, error: res.error ?? 'unknown' });
          }
        }
      } catch (err) {
        const error = err instanceof Error ? err.message : 'unknown';
        for (const e of group) {
          totalFailed++;
          allResults.push({ notificationId: e.id, success: false, error });
          this.emitter.emit({ type: 'notification:failed', envelope: e, error });
        }
      }
    }

    const batchResult: BatchResult = {
      batchId,
      sent: totalSent,
      failed: totalFailed,
      results: allResults,
    };
    this.emitter.emit({ type: 'batch:completed', batchId, result: batchResult });
  }

  private resolveProvider(channel: NotificationChannel): NotificationProvider | undefined {
    if (channel === 'all') {
      return this.providers.get('fcm') ?? this.providers.values().next().value;
    }
    return this.providers.get(channel);
  }
}

type NotificationChannel = 'fcm' | 'apns' | 'web-push' | 'all';

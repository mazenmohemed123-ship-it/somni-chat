import type { NotificationEnvelope, BatchConfig, DEFAULT_BATCH_CONFIG } from '../types/notification.js';
import { generateId } from '../utils/uuid.js';

interface Bucket {
  envelopes: NotificationEnvelope[];
  firstQueuedAt: number;
  flushTimer: ReturnType<typeof setTimeout> | null;
}

export type FlushCallback = (batchId: string, envelopes: NotificationEnvelope[]) => Promise<void>;

export class BatchQueue {
  private readonly config: BatchConfig;
  private readonly onFlush: FlushCallback;
  private readonly buckets: Map<string, Bucket> = new Map();
  private flushing = false;

  constructor(config: BatchConfig, onFlush: FlushCallback) {
    this.config = config;
    this.onFlush = onFlush;
  }

  enqueue(envelope: NotificationEnvelope): void {
    const key = this.getBucketKey(envelope);
    let bucket = this.buckets.get(key);

    if (!bucket) {
      bucket = { envelopes: [], firstQueuedAt: Date.now(), flushTimer: null };
      this.buckets.set(key, bucket);
    }

    if (this.config.collapseByConversation && envelope.conversationId) {
      this.collapse(bucket, envelope);
    } else {
      bucket.envelopes.push(envelope);
    }

    if (bucket.envelopes.length >= this.config.maxBatchSize) {
      this.flushBucket(key, bucket);
      return;
    }

    const age = Date.now() - bucket.firstQueuedAt;
    const delay = Math.min(this.config.windowMs, this.config.maxDelayMs - age);

    if (delay <= 0) {
      this.flushBucket(key, bucket);
      return;
    }

    if (!bucket.flushTimer) {
      bucket.flushTimer = setTimeout(() => {
        const b = this.buckets.get(key);
        if (b) this.flushBucket(key, b);
      }, delay);
    }
  }

  private collapse(bucket: Bucket, incoming: NotificationEnvelope): void {
    const existing = bucket.envelopes.findIndex(
      (e) => e.conversationId === incoming.conversationId && e.target.userId === incoming.target.userId
    );
    if (existing >= 0) {
      const prev = bucket.envelopes[existing];
      const prevCount = Number(prev.payload.data?.['collapsed'] ?? 0) + 1;
      bucket.envelopes[existing] = {
        ...incoming,
        payload: {
          ...incoming.payload,
          body: incoming.payload.body,
          data: { ...(incoming.payload.data ?? {}), collapsed: String(prevCount) },
        },
      };
    } else {
      bucket.envelopes.push(incoming);
    }
  }

  private getBucketKey(envelope: NotificationEnvelope): string {
    return `${envelope.target.userId}:${envelope.target.channel}`;
  }

  private flushBucket(key: string, bucket: Bucket): void {
    if (bucket.flushTimer) {
      clearTimeout(bucket.flushTimer);
      bucket.flushTimer = null;
    }
    const envelopes = bucket.envelopes.splice(0);
    this.buckets.delete(key);
    if (envelopes.length === 0) return;
    const batchId = generateId();
    void this.onFlush(batchId, envelopes);
  }

  flushAll(): void {
    for (const [key, bucket] of this.buckets) {
      this.flushBucket(key, bucket);
    }
  }

  get pendingCount(): number {
    let total = 0;
    for (const b of this.buckets.values()) total += b.envelopes.length;
    return total;
  }

  destroy(): void {
    for (const bucket of this.buckets.values()) {
      if (bucket.flushTimer) clearTimeout(bucket.flushTimer);
    }
    this.buckets.clear();
  }
}

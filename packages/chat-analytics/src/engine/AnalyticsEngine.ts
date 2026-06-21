import type { MetricEvent, MetricType, TimeWindow, DAUResult, DeliveryRateResult, ResponseTimeResult, AnalyticsSnapshot, ConversationStats } from '../types/metrics.js';
import type { AnalyticsProvider } from '../types/provider.js';
import type { AnalyticsEvent } from '../types/events.js';
import { MetricAggregator } from './MetricAggregator.js';
import { AnalyticsEmitter } from './AnalyticsEmitter.js';

export interface AnalyticsEngineConfig {
  provider?: AnalyticsProvider;
  snapshotIntervalMs?: number;
  pruneIntervalMs?: number;
}

export class AnalyticsEngine {
  private readonly aggregator: MetricAggregator;
  private readonly emitter: AnalyticsEmitter;
  private readonly provider: AnalyticsProvider | undefined;
  private readonly snapshotIntervalMs: number;
  private snapshotTimer: ReturnType<typeof setInterval> | null = null;
  private pruneTimer: ReturnType<typeof setInterval> | null = null;
  private destroyed = false;

  constructor(config: AnalyticsEngineConfig = {}) {
    this.aggregator = new MetricAggregator();
    this.emitter = new AnalyticsEmitter();
    this.provider = config.provider;
    this.snapshotIntervalMs = config.snapshotIntervalMs ?? 60_000;

    if (this.snapshotIntervalMs > 0) {
      this.snapshotTimer = setInterval(() => this.emitSnapshot(), this.snapshotIntervalMs);
      if (this.snapshotTimer.unref) this.snapshotTimer.unref();
    }

    const pruneMs = config.pruneIntervalMs ?? 3_600_000;
    if (pruneMs > 0) {
      this.pruneTimer = setInterval(() => this.aggregator.clear(), pruneMs);
      if (this.pruneTimer.unref) this.pruneTimer.unref();
    }
  }

  track(event: Omit<MetricEvent, 'timestamp'> & { timestamp?: number }): void {
    if (this.destroyed) return;
    const full: MetricEvent = { ...event, timestamp: event.timestamp ?? Date.now() };
    this.aggregator.ingest(full);
    this.emitter.emit({ type: 'metric:recorded', event: full });
    if (this.provider) {
      try {
        void Promise.resolve(this.provider.record(full));
      } catch (err) {
        this.emitter.emit({ type: 'error', error: err instanceof Error ? err.message : 'unknown', context: 'provider.record' });
      }
    }
  }

  on<T extends AnalyticsEvent>(type: T['type'], listener: (e: T) => void): () => void {
    return this.emitter.on(type, listener);
  }

  // ── Read methods ────────────────────────────────────────────────

  getDAU(date?: string): DAUResult {
    return this.aggregator.getDAU(date);
  }

  getDeliveryRates(window: TimeWindow = 'hour', now?: number): DeliveryRateResult {
    return this.aggregator.getDeliveryRates(window, now);
  }

  getResponseTime(): ResponseTimeResult {
    return this.aggregator.getResponseTime();
  }

  getConversationStats(conversationId: string): ConversationStats | undefined {
    return this.aggregator.getConversationStats(conversationId);
  }

  getAllConversationStats(): ConversationStats[] {
    return this.aggregator.getAllConversationStats();
  }

  getErrorCount(window: TimeWindow = 'hour', now?: number): number {
    return this.aggregator.getErrorCount(window, now);
  }

  snapshot(now?: number): AnalyticsSnapshot {
    return this.aggregator.snapshot(now);
  }

  async flush(): Promise<void> {
    await this.provider?.flush?.();
  }

  destroy(): void {
    this.destroyed = true;
    if (this.snapshotTimer) clearInterval(this.snapshotTimer);
    if (this.pruneTimer) clearInterval(this.pruneTimer);
    this.emitter.removeAllListeners();
  }

  private emitSnapshot(): void {
    const snap = this.aggregator.snapshot();
    this.emitter.emit({ type: 'snapshot:ready', snapshot: snap });
  }
}

import type { MetricEvent, TimeWindow, DAUResult, DeliveryRateResult, ResponseTimeResult, ConversationStats } from '../types/metrics.js';
import { TimeSeriesBuffer } from './TimeSeriesBuffer.js';

export class MetricAggregator {
  // Per-day active users: date → Set<userId>
  private readonly dauBuckets: Map<string, Set<string>> = new Map();

  // Message delivery tracking
  private readonly sentBuffer = new TimeSeriesBuffer();
  private readonly deliveredBuffer = new TimeSeriesBuffer();
  private readonly failedBuffer = new TimeSeriesBuffer();
  private readonly readBuffer = new TimeSeriesBuffer();

  // Response times (milliseconds) — ring buffer of raw values
  private readonly responseTimes: number[] = [];
  private readonly maxResponseSamples = 10_000;

  // Response time tracking: sentAt per message
  private readonly pendingSent: Map<string, number> = new Map();

  // Conversation stats
  private readonly convStats: Map<string, ConversationStats> = new Map();

  // Error count
  private readonly errorBuffer = new TimeSeriesBuffer();

  // Calls
  private readonly callsStarted = new TimeSeriesBuffer();
  private readonly callsEnded = new TimeSeriesBuffer();

  ingest(event: MetricEvent): void {
    const ts = event.timestamp;
    switch (event.type) {
      case 'message:sent':
        this.sentBuffer.record(1, ts);
        this.trackDAU(event.userId, ts);
        if (event.conversationId) {
          const msgId = event.metadata?.['messageId'] as string | undefined;
          if (msgId) this.pendingSent.set(msgId, ts);
          this.getOrCreateConv(event.conversationId).messageCount++;
          this.getOrCreateConv(event.conversationId).lastActivityAt = ts;
        }
        break;

      case 'message:delivered':
        this.deliveredBuffer.record(1, ts);
        if (event.conversationId) {
          const msgId = event.metadata?.['messageId'] as string | undefined;
          if (msgId) {
            const sentAt = this.pendingSent.get(msgId);
            if (sentAt) {
              this.recordResponseTime(ts - sentAt);
              this.pendingSent.delete(msgId);
            }
          }
        }
        break;

      case 'message:read':
        this.readBuffer.record(1, ts);
        break;

      case 'message:failed':
        this.failedBuffer.record(1, ts);
        this.errorBuffer.record(1, ts);
        break;

      case 'user:active':
        this.trackDAU(event.userId, ts);
        if (event.conversationId) {
          const conv = this.getOrCreateConv(event.conversationId);
          conv.activeParticipants = Math.max(conv.activeParticipants, 1);
        }
        break;

      case 'error':
        this.errorBuffer.record(1, ts);
        break;

      case 'call:started':
        this.callsStarted.record(1, ts);
        break;

      case 'call:ended':
        this.callsEnded.record(1, ts);
        break;
    }
  }

  getDAU(date?: string): DAUResult {
    const key = date ?? this.dateKey(Date.now());
    const set = this.dauBuckets.get(key) ?? new Set<string>();
    return { date: key, activeUsers: set.size, uniqueUsers: new Set(set) };
  }

  getDeliveryRates(window: TimeWindow, now = Date.now()): DeliveryRateResult {
    const sent = this.sentBuffer.sum(window, now);
    const delivered = this.deliveredBuffer.sum(window, now);
    const failed = this.failedBuffer.sum(window, now);
    const read = this.readBuffer.sum(window, now);
    return {
      sent,
      delivered,
      failed,
      read,
      deliveryRate: sent > 0 ? delivered / sent : 0,
      readRate: delivered > 0 ? read / delivered : 0,
      windowStart: now - this.windowMs(window),
      windowEnd: now,
    };
  }

  getResponseTime(): ResponseTimeResult {
    const samples = this.responseTimes.slice();
    if (samples.length === 0) {
      return { p50: 0, p95: 0, p99: 0, mean: 0, min: 0, max: 0, sampleCount: 0 };
    }
    samples.sort((a, b) => a - b);
    const mean = samples.reduce((s, v) => s + v, 0) / samples.length;
    return {
      p50: this.percentile(samples, 0.5),
      p95: this.percentile(samples, 0.95),
      p99: this.percentile(samples, 0.99),
      mean,
      min: samples[0],
      max: samples[samples.length - 1],
      sampleCount: samples.length,
    };
  }

  getConversationStats(conversationId: string): ConversationStats | undefined {
    return this.convStats.get(conversationId);
  }

  getAllConversationStats(): ConversationStats[] {
    return [...this.convStats.values()];
  }

  getErrorCount(window: TimeWindow, now = Date.now()): number {
    return this.errorBuffer.sum(window, now);
  }

  snapshot(now = Date.now()): import('../types/metrics.js').AnalyticsSnapshot {
    const rates = this.getDeliveryRates('hour', now);
    const rt = this.getResponseTime();
    const dau = this.getDAU(this.dateKey(now));
    return {
      timestamp: now,
      dau: dau.activeUsers,
      totalMessages: rates.sent,
      deliveryRate: rates.deliveryRate,
      avgResponseTimeMs: rt.mean,
      activeConversations: this.convStats.size,
      errorCount: this.getErrorCount('hour', now),
    };
  }

  clear(): void {
    this.dauBuckets.clear();
    this.sentBuffer.clear();
    this.deliveredBuffer.clear();
    this.failedBuffer.clear();
    this.readBuffer.clear();
    this.responseTimes.length = 0;
    this.pendingSent.clear();
    this.convStats.clear();
    this.errorBuffer.clear();
    this.callsStarted.clear();
    this.callsEnded.clear();
  }

  private trackDAU(userId: string, timestamp: number): void {
    const key = this.dateKey(timestamp);
    let set = this.dauBuckets.get(key);
    if (!set) { set = new Set(); this.dauBuckets.set(key, set); }
    set.add(userId);
  }

  private dateKey(timestamp: number): string {
    return new Date(timestamp).toISOString().slice(0, 10);
  }

  private windowMs(window: TimeWindow): number {
    const map: Record<TimeWindow, number> = {
      minute: 60_000, hour: 3_600_000, day: 86_400_000, week: 604_800_000,
    };
    return map[window];
  }

  private recordResponseTime(ms: number): void {
    this.responseTimes.push(ms);
    if (this.responseTimes.length > this.maxResponseSamples) {
      this.responseTimes.splice(0, Math.floor(this.maxResponseSamples * 0.1));
    }
  }

  private getOrCreateConv(id: string): ConversationStats {
    let s = this.convStats.get(id);
    if (!s) {
      s = { conversationId: id, messageCount: 0, activeParticipants: 0, avgResponseTimeMs: 0, lastActivityAt: 0 };
      this.convStats.set(id, s);
    }
    return s;
  }

  private percentile(sorted: number[], p: number): number {
    const idx = Math.max(0, Math.ceil(p * sorted.length) - 1);
    return sorted[idx];
  }
}

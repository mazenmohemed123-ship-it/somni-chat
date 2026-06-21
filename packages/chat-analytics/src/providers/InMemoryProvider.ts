import type { AnalyticsProvider } from '../types/provider.js';
import type { MetricEvent, TimeWindow, TimeSeriesPoint } from '../types/metrics.js';
import { TimeSeriesBuffer } from '../engine/TimeSeriesBuffer.js';

export class InMemoryProvider implements AnalyticsProvider {
  private readonly buffers: Map<string, TimeSeriesBuffer> = new Map();
  readonly events: MetricEvent[] = [];

  record(event: MetricEvent): void {
    this.events.push(event);
    let buf = this.buffers.get(event.type);
    if (!buf) { buf = new TimeSeriesBuffer(); this.buffers.set(event.type, buf); }
    buf.record(1, event.timestamp);
  }

  async query(type: MetricEvent['type'], window: TimeWindow, now = Date.now()): Promise<TimeSeriesPoint[]> {
    const buf = this.buffers.get(type);
    return buf ? buf.query(window, now) : [];
  }

  async flush(): Promise<void> { /* no-op for in-memory */ }

  async clear(): Promise<void> {
    this.buffers.clear();
    this.events.length = 0;
  }
}

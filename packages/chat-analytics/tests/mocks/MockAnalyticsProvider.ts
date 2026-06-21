import type { AnalyticsProvider } from '../../src/types/provider.js';
import type { MetricEvent, TimeWindow, TimeSeriesPoint } from '../../src/types/metrics.js';

export class MockAnalyticsProvider implements AnalyticsProvider {
  readonly recorded: MetricEvent[] = [];
  shouldThrow = false;

  record(event: MetricEvent): void {
    if (this.shouldThrow) throw new Error('provider error');
    this.recorded.push(event);
  }

  async query(_type: MetricEvent['type'], _window: TimeWindow): Promise<TimeSeriesPoint[]> {
    return [];
  }

  async flush(): Promise<void> {}

  async clear(): Promise<void> {
    this.recorded.length = 0;
  }

  reset(): void {
    this.recorded.length = 0;
    this.shouldThrow = false;
  }
}

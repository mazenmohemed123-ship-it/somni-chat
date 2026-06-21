import type { MetricEvent, TimeWindow, TimeSeriesPoint } from './metrics.js';

export interface AnalyticsProvider {
  record(event: MetricEvent): Promise<void> | void;
  query(type: MetricEvent['type'], window: TimeWindow, now?: number): Promise<TimeSeriesPoint[]>;
  flush?(): Promise<void>;
  clear?(): Promise<void>;
}

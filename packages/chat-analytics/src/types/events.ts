import type { MetricEvent, AnalyticsSnapshot } from './metrics.js';

export type AnalyticsEventType =
  | 'metric:recorded'
  | 'snapshot:ready'
  | 'error';

export type AnalyticsEvent =
  | { type: 'metric:recorded'; event: MetricEvent }
  | { type: 'snapshot:ready'; snapshot: AnalyticsSnapshot }
  | { type: 'error'; error: string; context?: string };

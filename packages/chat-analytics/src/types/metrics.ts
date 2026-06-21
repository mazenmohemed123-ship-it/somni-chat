export type MetricType =
  | 'message:sent'
  | 'message:delivered'
  | 'message:read'
  | 'message:failed'
  | 'user:active'
  | 'user:session:start'
  | 'user:session:end'
  | 'call:started'
  | 'call:connected'
  | 'call:ended'
  | 'notification:sent'
  | 'notification:opened'
  | 'error';

export interface MetricEvent {
  type: MetricType;
  userId: string;
  conversationId?: string;
  timestamp: number;
  metadata?: Record<string, string | number | boolean>;
}

export type TimeWindow = 'minute' | 'hour' | 'day' | 'week';

export interface TimeSeriesPoint {
  timestamp: number;
  value: number;
  label?: string;
}

export interface DAUResult {
  date: string;
  activeUsers: number;
  uniqueUsers: Set<string>;
}

export interface DeliveryRateResult {
  sent: number;
  delivered: number;
  failed: number;
  read: number;
  deliveryRate: number;
  readRate: number;
  windowStart: number;
  windowEnd: number;
}

export interface ResponseTimeResult {
  p50: number;
  p95: number;
  p99: number;
  mean: number;
  min: number;
  max: number;
  sampleCount: number;
}

export interface ConversationStats {
  conversationId: string;
  messageCount: number;
  activeParticipants: number;
  avgResponseTimeMs: number;
  lastActivityAt: number;
}

export interface AnalyticsSnapshot {
  timestamp: number;
  dau: number;
  totalMessages: number;
  deliveryRate: number;
  avgResponseTimeMs: number;
  activeConversations: number;
  errorCount: number;
}

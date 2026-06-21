export type NotificationChannel = 'fcm' | 'apns' | 'web-push' | 'all';

export interface NotificationTarget {
  userId: string;
  token: string;
  channel: NotificationChannel;
  platform?: 'android' | 'ios' | 'web';
  locale?: string;
}

export interface NotificationPayload {
  title: string;
  body: string;
  imageUrl?: string;
  icon?: string;
  badge?: number;
  sound?: string | boolean;
  data?: Record<string, string>;
  category?: string;
  collapseKey?: string;
  ttlSeconds?: number;
  priority?: 'normal' | 'high';
  clickAction?: string;
}

export interface NotificationEnvelope {
  id: string;
  target: NotificationTarget;
  payload: NotificationPayload;
  createdAt: number;
  scheduledAt?: number;
  conversationId?: string;
  senderId?: string;
}

export interface BatchConfig {
  maxBatchSize: number;
  windowMs: number;
  maxDelayMs: number;
  collapseByConversation: boolean;
}

export const DEFAULT_BATCH_CONFIG: BatchConfig = {
  maxBatchSize: 100,
  windowMs: 500,
  maxDelayMs: 2000,
  collapseByConversation: true,
};

export interface NotificationResult {
  notificationId: string;
  success: boolean;
  error?: string;
  retryAfter?: number;
}

export interface BatchResult {
  batchId: string;
  sent: number;
  failed: number;
  results: NotificationResult[];
}

export interface RateLimitConfig {
  maxPerUserPerMinute: number;
  maxPerUserPerHour: number;
  maxPerUserPerDay: number;
}

export const DEFAULT_RATE_LIMIT: RateLimitConfig = {
  maxPerUserPerMinute: 10,
  maxPerUserPerHour: 120,
  maxPerUserPerDay: 500,
};

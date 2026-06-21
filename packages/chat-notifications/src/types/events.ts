import type { NotificationEnvelope, NotificationResult, BatchResult } from './notification.js';

export type NotificationEventType =
  | 'notification:queued'
  | 'notification:sent'
  | 'notification:failed'
  | 'batch:started'
  | 'batch:completed'
  | 'rate-limit:exceeded'
  | 'token:invalid';

export type NotificationEvent =
  | { type: 'notification:queued'; envelope: NotificationEnvelope }
  | { type: 'notification:sent'; envelope: NotificationEnvelope; result: NotificationResult }
  | { type: 'notification:failed'; envelope: NotificationEnvelope; error: string }
  | { type: 'batch:started'; batchId: string; count: number }
  | { type: 'batch:completed'; batchId: string; result: BatchResult }
  | { type: 'rate-limit:exceeded'; userId: string; window: string }
  | { type: 'token:invalid'; userId: string; token: string; channel: string };

export type NotificationEventListener<T extends NotificationEvent = NotificationEvent> = (
  event: T
) => void;

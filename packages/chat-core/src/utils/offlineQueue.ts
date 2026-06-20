import type { SendMessageInput } from '../types/message';

export interface QueuedOperation {
  id: string;
  type: 'send_message';
  payload: SendMessageInput;
  attempts: number;
  created_at: number;
}

/**
 * In-memory queue for operations that failed due to connectivity issues.
 * Persists to localStorage when available for cross-tab and page-refresh resilience.
 */
export class OfflineQueue {
  private queue: QueuedOperation[] = [];
  private readonly storageKey = 'somni_offline_queue';

  constructor() {
    this.hydrate();
  }

  enqueue(op: Omit<QueuedOperation, 'attempts' | 'created_at'>): void {
    const entry: QueuedOperation = { ...op, attempts: 0, created_at: Date.now() };
    this.queue.push(entry);
    this.persist();
  }

  dequeue(): QueuedOperation | undefined {
    const op = this.queue.shift();
    this.persist();
    return op;
  }

  peek(): QueuedOperation | undefined {
    return this.queue[0];
  }

  size(): number {
    return this.queue.length;
  }

  isEmpty(): boolean {
    return this.queue.length === 0;
  }

  incrementAttempts(id: string): void {
    const op = this.queue.find((o) => o.id === id);
    if (op) {
      op.attempts++;
      this.persist();
    }
  }

  remove(id: string): void {
    this.queue = this.queue.filter((o) => o.id !== id);
    this.persist();
  }

  drain(): QueuedOperation[] {
    const all = [...this.queue];
    this.queue = [];
    this.persist();
    return all;
  }

  private persist(): void {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(this.storageKey, JSON.stringify(this.queue));
      }
    } catch {
      // localStorage unavailable (SSR, private browsing quota exceeded)
    }
  }

  private hydrate(): void {
    try {
      if (typeof localStorage !== 'undefined') {
        const raw = localStorage.getItem(this.storageKey);
        if (raw) this.queue = JSON.parse(raw) as QueuedOperation[];
      }
    } catch {
      this.queue = [];
    }
  }
}

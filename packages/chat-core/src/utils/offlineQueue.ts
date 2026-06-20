import type { SendMessageInput } from '../types/message';

export interface QueuedOperation {
  id: string;
  type: 'send_message';
  payload: SendMessageInput;
  attempts: number;
  created_at: number;
  /** Epoch ms before which this op should not be retried (backoff gate) */
  next_retry_at: number;
  /** Last error message, kept for diagnostics / dead-letter inspection */
  last_error?: string;
}

export interface OfflineQueueOptions {
  /** Max retry attempts before moving an op to the dead-letter queue (default: 8) */
  maxRetries?: number;
  /** Storage namespace key (default: "somni_offline_queue_v2") */
  storageKey?: string;
  /** Pluggable persistence — defaults to localStorage when available */
  storage?: PersistentStorage;
}

export interface PersistentStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

interface PersistShape {
  version: 2;
  queue: QueuedOperation[];
  deadLetter: QueuedOperation[];
}

function defaultStorage(): PersistentStorage | null {
  try {
    if (typeof localStorage !== 'undefined') return localStorage;
  } catch {
    /* access denied (SSR / sandboxed iframe) */
  }
  return null;
}

/**
 * Persistent, FIFO, retry-aware queue for operations that could not be flushed
 * to the backend (offline, network error, server 5xx).
 *
 * Hardening vs. naive queue:
 *  - Survives refresh / tab crash via versioned storage snapshot.
 *  - Preserves message ORDER: failed ops stay at the head, they are not
 *    re-appended to the tail.
 *  - Per-op exponential backoff gate (`next_retry_at`) prevents reconnect storms.
 *  - Dead-letter queue captures ops that exceed `maxRetries` instead of
 *    blocking the queue forever.
 */
export class OfflineQueue {
  private queue: QueuedOperation[] = [];
  private deadLetter: QueuedOperation[] = [];
  private readonly maxRetries: number;
  private readonly storageKey: string;
  private readonly storage: PersistentStorage | null;

  constructor(options: OfflineQueueOptions = {}) {
    this.maxRetries = options.maxRetries ?? 8;
    this.storageKey = options.storageKey ?? 'somni_offline_queue_v2';
    this.storage = options.storage ?? defaultStorage();
    this.hydrate();
  }

  enqueue(op: Pick<QueuedOperation, 'id' | 'type' | 'payload'>): void {
    // Idempotent: never queue the same client operation twice.
    if (this.queue.some((o) => o.id === op.id)) return;
    this.queue.push({ ...op, attempts: 0, created_at: Date.now(), next_retry_at: 0 });
    this.persist();
  }

  /** Returns the head op only if it is eligible to run now (backoff elapsed). */
  peekReady(now = Date.now()): QueuedOperation | undefined {
    const head = this.queue[0];
    if (head && head.next_retry_at <= now) return head;
    return undefined;
  }

  peek(): QueuedOperation | undefined {
    return this.queue[0];
  }

  /** ms until the head op is eligible to run, or null if the queue is empty. */
  msUntilReady(now = Date.now()): number | null {
    const head = this.queue[0];
    if (!head) return null;
    return Math.max(0, head.next_retry_at - now);
  }

  /** Remove a successfully-flushed op from the head. */
  ack(id: string): void {
    this.queue = this.queue.filter((o) => o.id !== id);
    this.persist();
  }

  /**
   * Record a failed attempt. Applies backoff to `next_retry_at`, and moves the
   * op to the dead-letter queue once it exceeds `maxRetries`.
   * @returns true if the op was dead-lettered.
   */
  recordFailure(id: string, error: string, computeDelay: (attempt: number) => number): boolean {
    const op = this.queue.find((o) => o.id === id);
    if (!op) return false;
    op.attempts += 1;
    op.last_error = error;

    if (op.attempts >= this.maxRetries) {
      this.queue = this.queue.filter((o) => o.id !== id);
      this.deadLetter.push(op);
      this.persist();
      return true;
    }

    op.next_retry_at = Date.now() + computeDelay(op.attempts);
    this.persist();
    return false;
  }

  size(): number {
    return this.queue.length;
  }

  isEmpty(): boolean {
    return this.queue.length === 0;
  }

  /** Inspect (and optionally drain) permanently failed operations. */
  getDeadLetter(): readonly QueuedOperation[] {
    return this.deadLetter;
  }

  clearDeadLetter(): QueuedOperation[] {
    const dead = this.deadLetter;
    this.deadLetter = [];
    this.persist();
    return dead;
  }

  /** Re-queue a dead-lettered op for another round of attempts. */
  retryDeadLetter(id: string): boolean {
    const idx = this.deadLetter.findIndex((o) => o.id === id);
    if (idx === -1) return false;
    const [op] = this.deadLetter.splice(idx, 1);
    if (op) {
      op.attempts = 0;
      op.next_retry_at = 0;
      this.queue.push(op);
    }
    this.persist();
    return true;
  }

  private persist(): void {
    if (!this.storage) return;
    try {
      const snapshot: PersistShape = { version: 2, queue: this.queue, deadLetter: this.deadLetter };
      this.storage.setItem(this.storageKey, JSON.stringify(snapshot));
    } catch {
      /* quota exceeded / serialization error — keep in-memory copy */
    }
  }

  private hydrate(): void {
    if (!this.storage) return;
    try {
      const raw = this.storage.getItem(this.storageKey);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Partial<PersistShape>;
      if (parsed && parsed.version === 2) {
        this.queue = Array.isArray(parsed.queue) ? parsed.queue : [];
        this.deadLetter = Array.isArray(parsed.deadLetter) ? parsed.deadLetter : [];
      }
    } catch {
      this.queue = [];
      this.deadLetter = [];
    }
  }
}

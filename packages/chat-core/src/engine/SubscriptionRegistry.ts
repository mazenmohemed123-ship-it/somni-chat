import type { ChatEvent } from '../types/events';
import type { UnsubscribeFn } from '../adapter/ChatAdapter';

type Callback = (event: ChatEvent) => void;

/**
 * Fan-out registry: multiplexes many local subscribers onto a SINGLE underlying
 * adapter subscription per key (e.g. per conversation).
 *
 * Fixes two real bugs in the naive approach:
 *  1. A second `subscribeMessages(sameConv, cb2)` previously returned the first
 *     subscription and silently dropped `cb2`. Now every callback is invoked.
 *  2. Unsubscribing one component used to tear down the shared adapter channel
 *     for everyone. Now the adapter channel is torn down only when the LAST
 *     local subscriber leaves — preventing both leaks and premature teardown.
 */
export class SubscriptionRegistry {
  private readonly entries = new Map<
    string,
    { callbacks: Set<Callback>; teardown: UnsubscribeFn }
  >();

  /**
   * @param key       unique channel key (e.g. `messages:<conversationId>`)
   * @param callback  local subscriber
   * @param connect   called only once per key to open the adapter channel
   */
  subscribe(key: string, callback: Callback, connect: (fanout: Callback) => UnsubscribeFn): UnsubscribeFn {
    let entry = this.entries.get(key);

    if (!entry) {
      const callbacks = new Set<Callback>();
      const fanout: Callback = (event) => {
        for (const cb of callbacks) {
          try {
            cb(event);
          } catch (err) {
            console.error('[Somni] Subscriber callback error:', err);
          }
        }
      };
      const teardown = connect(fanout);
      entry = { callbacks, teardown };
      this.entries.set(key, entry);
    }

    entry.callbacks.add(callback);

    return () => {
      const current = this.entries.get(key);
      if (!current) return;
      current.callbacks.delete(callback);
      if (current.callbacks.size === 0) {
        current.teardown();
        this.entries.delete(key);
      }
    };
  }

  has(key: string): boolean {
    return this.entries.has(key);
  }

  subscriberCount(key: string): number {
    return this.entries.get(key)?.callbacks.size ?? 0;
  }

  teardownAll(): void {
    for (const [, entry] of this.entries) {
      try {
        entry.teardown();
      } catch {
        /* best-effort */
      }
    }
    this.entries.clear();
  }
}

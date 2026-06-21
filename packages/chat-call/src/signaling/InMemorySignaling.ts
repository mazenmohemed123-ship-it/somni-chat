import type { CallSignaling, SignalMessage } from '../types/signaling';

/**
 * A shared in-process signaling bus. Each participant gets its own
 * {@link CallSignaling} endpoint via `endpoint(userId)`; messages addressed to a
 * specific `to` are delivered only to that endpoint, otherwise broadcast to all
 * other endpoints. Great for local same-tab demos and for deterministic tests.
 */
export class InMemorySignalingBus {
  private readonly endpoints = new Map<string, Set<(m: SignalMessage) => void>>();

  endpoint(userId: string): CallSignaling {
    if (!this.endpoints.has(userId)) this.endpoints.set(userId, new Set());
    const listeners = this.endpoints.get(userId)!;

    return {
      send: (message: SignalMessage) => {
        // Deliver asynchronously to mimic a network hop.
        queueMicrotask(() => this.deliver(userId, message));
      },
      subscribe: (callback) => {
        listeners.add(callback);
        return () => listeners.delete(callback);
      },
    };
  }

  private deliver(fromUser: string, message: SignalMessage): void {
    const targeted = 'to' in message && typeof message.to === 'string' ? message.to : undefined;
    for (const [userId, listeners] of this.endpoints) {
      if (userId === fromUser) continue;
      if (targeted && userId !== targeted) continue;
      for (const cb of listeners) cb(message);
    }
  }

  reset(): void {
    this.endpoints.clear();
  }
}

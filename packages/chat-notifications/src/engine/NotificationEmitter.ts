import type { NotificationEvent, NotificationEventType, NotificationEventListener } from '../types/events.js';

type Listener = (event: NotificationEvent) => void;

export class NotificationEmitter {
  private readonly listeners: Map<string, Set<Listener>> = new Map();

  on<T extends NotificationEvent>(type: T['type'], listener: NotificationEventListener<T>): () => void {
    let set = this.listeners.get(type);
    if (!set) { set = new Set(); this.listeners.set(type, set); }
    set.add(listener as Listener);
    return () => set!.delete(listener as Listener);
  }

  emit(event: NotificationEvent): void {
    const set = this.listeners.get(event.type);
    if (!set) return;
    for (const fn of set) {
      try { fn(event); } catch { /* isolate listener errors */ }
    }
  }

  removeAllListeners(): void {
    this.listeners.clear();
  }
}

import type { AnalyticsEvent } from '../types/events.js';

type Listener = (event: AnalyticsEvent) => void;

export class AnalyticsEmitter {
  private readonly listeners: Map<string, Set<Listener>> = new Map();

  on<T extends AnalyticsEvent>(type: T['type'], listener: (e: T) => void): () => void {
    let set = this.listeners.get(type);
    if (!set) { set = new Set(); this.listeners.set(type, set); }
    set.add(listener as Listener);
    return () => set!.delete(listener as Listener);
  }

  emit(event: AnalyticsEvent): void {
    const set = this.listeners.get(event.type);
    if (!set) return;
    for (const fn of set) {
      try { fn(event); } catch { /* isolate */ }
    }
  }

  removeAllListeners(): void {
    this.listeners.clear();
  }
}

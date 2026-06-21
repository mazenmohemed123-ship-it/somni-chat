import type { CallEvent, CallEventType, CallEventListener } from '../types/events';

/** Small type-safe emitter for call events with per-listener error isolation. */
export class CallEmitter {
  private listeners = new Map<string, Set<CallEventListener>>();

  on<T extends CallEventType>(type: T, listener: CallEventListener<T>): () => void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    const set = this.listeners.get(type)!;
    set.add(listener as CallEventListener);
    return () => set.delete(listener as CallEventListener);
  }

  emit(event: CallEvent): void {
    for (const listener of this.listeners.get(event.type) ?? []) {
      try {
        (listener as CallEventListener)(event);
      } catch (err) {
        console.error('[Somni Call] listener error:', err);
      }
    }
  }

  removeAll(): void {
    this.listeners.clear();
  }
}

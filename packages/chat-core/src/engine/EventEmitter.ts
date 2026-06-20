import type { ChatEvent, ChatEventType, EventListener } from '../types/events';

/**
 * Type-safe event emitter for ChatEngine.
 * All realtime events flow through this single bus.
 */
export class ChatEventEmitter {
  private listeners = new Map<string, Set<EventListener<ChatEventType>>>();

  on<T extends ChatEventType>(type: T, listener: EventListener<T>): () => void {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set());
    }
    const set = this.listeners.get(type)!;
    set.add(listener as EventListener<ChatEventType>);

    return () => {
      set.delete(listener as EventListener<ChatEventType>);
    };
  }

  once<T extends ChatEventType>(type: T, listener: EventListener<T>): () => void {
    const unsubscribe = this.on(type, ((event: Extract<ChatEvent, { type: T }>) => {
      unsubscribe();
      void listener(event);
    }) as EventListener<T>);
    return unsubscribe;
  }

  emit(event: ChatEvent): void {
    const set = this.listeners.get(event.type);
    if (!set) return;
    for (const listener of set) {
      try {
        void listener(event as never);
      } catch (err) {
        console.error('[Somni] Event listener error:', err);
      }
    }

    // Also emit to wildcard listeners
    const wildcards = this.listeners.get('*');
    if (wildcards) {
      for (const listener of wildcards) {
        try {
          void listener(event as never);
        } catch (err) {
          console.error('[Somni] Wildcard listener error:', err);
        }
      }
    }
  }

  removeAllListeners(type?: ChatEventType): void {
    if (type) {
      this.listeners.delete(type);
    } else {
      this.listeners.clear();
    }
  }
}

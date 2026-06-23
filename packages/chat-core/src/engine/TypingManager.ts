import type { ChatAdapter } from '../adapter/ChatAdapter';
import type { ChatEventEmitter } from './EventEmitter';
import type { TypingIndicator } from '../types/presence';

export class TypingManager {
  private readonly activeTypers = new Map<string, Map<string, ReturnType<typeof setTimeout>>>();
  // Per-conversation outbound typing state (one global boolean was wrong for multi-conversation)
  private readonly sendTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly activeConversations = new Set<string>();
  private readonly unsubscribers = new Map<string, () => void>();

  private readonly adapter: ChatAdapter;
  private readonly emitter: ChatEventEmitter;
  private readonly userId: string;
  private readonly timeoutMs: number;

  constructor(
    adapter: ChatAdapter,
    emitter: ChatEventEmitter,
    userId: string,
    timeoutMs: number
  ) {
    this.adapter = adapter;
    this.emitter = emitter;
    this.userId = userId;
    this.timeoutMs = timeoutMs;
  }

  /** Call on every keystroke */
  async notifyTyping(conversationId: string): Promise<void> {
    if (!this.activeConversations.has(conversationId)) {
      this.activeConversations.add(conversationId);
      await this.adapter.updateTyping({ conversation_id: conversationId, user_id: this.userId, is_typing: true });
    }

    const existing = this.sendTimers.get(conversationId);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      this.activeConversations.delete(conversationId);
      this.sendTimers.delete(conversationId);
      void this.adapter.updateTyping({ conversation_id: conversationId, user_id: this.userId, is_typing: false });
    }, this.timeoutMs);
    this.sendTimers.set(conversationId, timer);
  }

  /** Explicitly stop typing (e.g., on message send) */
  async stopTyping(conversationId: string): Promise<void> {
    const timer = this.sendTimers.get(conversationId);
    if (timer) {
      clearTimeout(timer);
      this.sendTimers.delete(conversationId);
    }
    if (this.activeConversations.has(conversationId)) {
      this.activeConversations.delete(conversationId);
      await this.adapter.updateTyping({ conversation_id: conversationId, user_id: this.userId, is_typing: false });
    }
  }

  subscribeToConversation(conversationId: string): () => void {
    if (this.unsubscribers.has(conversationId)) {
      return this.unsubscribers.get(conversationId)!;
    }

    const unsub = this.adapter.subscribeTyping(conversationId, (event) => {
      if (event.type !== 'typing:updated') return;
      const { user_id, is_typing } = event.payload;
      if (user_id === this.userId) return;

      if (!this.activeTypers.has(conversationId)) {
        this.activeTypers.set(conversationId, new Map());
      }
      const typers = this.activeTypers.get(conversationId)!;

      if (is_typing) {
        const existing = typers.get(user_id);
        if (existing) clearTimeout(existing);
        const timer = setTimeout(() => {
          typers.delete(user_id);
          this.emitter.emit({
            type: 'typing:updated',
            payload: { conversation_id: conversationId, user_id, started_at: new Date().toISOString(), is_typing: false },
          });
        }, this.timeoutMs + 1000);
        typers.set(user_id, timer);
      } else {
        const existing = typers.get(user_id);
        if (existing) clearTimeout(existing);
        typers.delete(user_id);
      }

      this.emitter.emit(event);
    });

    this.unsubscribers.set(conversationId, unsub);
    return unsub;
  }

  getTypingUsers(conversationId: string): string[] {
    const typers = this.activeTypers.get(conversationId);
    return typers ? Array.from(typers.keys()) : [];
  }

  destroy(): void {
    for (const [, timer] of this.sendTimers) clearTimeout(timer);
    this.sendTimers.clear();
    this.activeConversations.clear();
    for (const [, timers] of this.activeTypers) {
      for (const [, t] of timers) clearTimeout(t);
    }
    for (const [, unsub] of this.unsubscribers) unsub();
    this.unsubscribers.clear();
  }
}

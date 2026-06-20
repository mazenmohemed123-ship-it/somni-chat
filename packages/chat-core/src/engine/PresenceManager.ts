import type { ChatAdapter } from '../adapter/ChatAdapter';
import type { ChatEventEmitter } from './EventEmitter';
import type { UserPresence, PresenceStatus } from '../types/presence';

export class PresenceManager {
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private readonly unsubscribers: Array<() => void> = [];
  private presenceCache = new Map<string, UserPresence>();

  constructor(
    private readonly adapter: ChatAdapter,
    private readonly emitter: ChatEventEmitter,
    private readonly userId: string,
    private readonly intervalMs: number
  ) {}

  async start(): Promise<void> {
    await this.adapter.updatePresence({ user_id: this.userId, status: 'online' });

    this.heartbeatTimer = setInterval(async () => {
      try {
        await this.adapter.updatePresence({ user_id: this.userId, status: 'online' });
      } catch {
        // Silently swallow — reconnect logic handles recovery
      }
    }, this.intervalMs);

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.onVisibilityChange);
    }
  }

  subscribeUsers(userIds: string[]): () => void {
    const unsub = this.adapter.subscribePresence(userIds, (event) => {
      if (event.type === 'presence:updated') {
        this.presenceCache.set(event.payload.user_id, event.payload);
        this.emitter.emit(event);
      }
    });
    this.unsubscribers.push(unsub);
    return unsub;
  }

  async fetchPresence(userIds: string[]): Promise<UserPresence[]> {
    const presences = await this.adapter.getPresence(userIds);
    for (const p of presences) this.presenceCache.set(p.user_id, p);
    return presences;
  }

  getFromCache(userId: string): UserPresence | null {
    return this.presenceCache.get(userId) ?? null;
  }

  async setStatus(status: PresenceStatus): Promise<void> {
    await this.adapter.updatePresence({ user_id: this.userId, status });
  }

  private onVisibilityChange = (): void => {
    if (typeof document === 'undefined') return;
    const status: PresenceStatus = document.visibilityState === 'visible' ? 'online' : 'away';
    void this.adapter.updatePresence({ user_id: this.userId, status });
  };

  async stop(): Promise<void> {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.onVisibilityChange);
    }
    try {
      await this.adapter.updatePresence({ user_id: this.userId, status: 'offline' });
    } catch {
      // Best-effort
    }
    for (const unsub of this.unsubscribers) unsub();
    this.unsubscribers.length = 0;
  }
}

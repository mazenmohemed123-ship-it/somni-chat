/**
 * Prevents duplicate messages from appearing in the UI.
 * Tracks client_ids of sent messages and server-confirmed IDs.
 * TTL-based cleanup avoids unbounded memory growth.
 */
export class DeduplicationCache {
  private readonly clientIds = new Map<string, number>();
  private readonly serverIds = new Map<string, number>();
  private readonly ttlMs: number;

  constructor(ttlMs = 60_000) {
    this.ttlMs = ttlMs;
  }

  hasClientId(clientId: string): boolean {
    return this.clientIds.has(clientId);
  }

  trackClientId(clientId: string): void {
    this.clientIds.set(clientId, Date.now());
    this.scheduleCleanup();
  }

  hasServerId(id: string): boolean {
    return this.serverIds.has(id);
  }

  trackServerId(id: string): void {
    this.serverIds.set(id, Date.now());
    this.scheduleCleanup();
  }

  private cleanupTimer: ReturnType<typeof setTimeout> | null = null;

  private scheduleCleanup(): void {
    if (this.cleanupTimer) return;
    this.cleanupTimer = setTimeout(() => {
      this.cleanupTimer = null;
      const cutoff = Date.now() - this.ttlMs;
      for (const [k, t] of this.clientIds) if (t < cutoff) this.clientIds.delete(k);
      for (const [k, t] of this.serverIds) if (t < cutoff) this.serverIds.delete(k);
    }, this.ttlMs);
  }
}

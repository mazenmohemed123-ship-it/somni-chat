/**
 * Prevents duplicate messages and reconciles optimistic (client_id) messages
 * with their server-confirmed counterparts (server id).
 *
 * Hardening:
 *  - Bounded: caps entry count to survive heavy realtime load without leaking.
 *  - TTL cleanup: stale entries expire so long-lived sessions stay flat.
 *  - Reconciliation map: client_id -> server_id lets the engine collapse the
 *    optimistic echo into a single canonical message.
 */
export class DeduplicationCache {
  private readonly clientIds = new Map<string, number>();
  private readonly serverIds = new Map<string, number>();
  private readonly reconciled = new Map<string, string>(); // client_id -> server_id
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  private cleanupTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(ttlMs = 60_000, maxEntries = 5000) {
    this.ttlMs = ttlMs;
    this.maxEntries = maxEntries;
  }

  hasClientId(clientId: string): boolean {
    return this.clientIds.has(clientId);
  }

  trackClientId(clientId: string): void {
    this.clientIds.set(clientId, Date.now());
    this.enforceBound(this.clientIds);
    this.scheduleCleanup();
  }

  hasServerId(id: string): boolean {
    return this.serverIds.has(id);
  }

  trackServerId(id: string): void {
    this.serverIds.set(id, Date.now());
    this.enforceBound(this.serverIds);
    this.scheduleCleanup();
  }

  /** Record that an optimistic client_id was confirmed as a given server id. */
  reconcile(clientId: string, serverId: string): void {
    this.reconciled.set(clientId, serverId);
    this.trackClientId(clientId);
    this.trackServerId(serverId);
    this.enforceBound(this.reconciled);
  }

  getReconciledServerId(clientId: string): string | undefined {
    return this.reconciled.get(clientId);
  }

  /** True if this incoming message is a duplicate we have already surfaced. */
  isDuplicate(serverId: string, clientId: string): boolean {
    if (this.serverIds.has(serverId)) return true;
    if (this.reconciled.get(clientId) === serverId) return true;
    return false;
  }

  clear(): void {
    this.clientIds.clear();
    this.serverIds.clear();
    this.reconciled.clear();
    if (this.cleanupTimer) {
      clearTimeout(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  private enforceBound(map: Map<string, unknown>): void {
    while (map.size > this.maxEntries) {
      const oldest = map.keys().next().value;
      if (oldest === undefined) break;
      map.delete(oldest);
    }
  }

  private scheduleCleanup(): void {
    if (this.cleanupTimer) return;
    this.cleanupTimer = setTimeout(() => {
      this.cleanupTimer = null;
      const cutoff = Date.now() - this.ttlMs;
      for (const [k, t] of this.clientIds) if (t < cutoff) this.clientIds.delete(k);
      for (const [k, t] of this.serverIds) if (t < cutoff) this.serverIds.delete(k);
    }, this.ttlMs);
    // Don't keep the Node.js event loop alive solely for cleanup.
    if (typeof this.cleanupTimer === 'object' && this.cleanupTimer && 'unref' in this.cleanupTimer) {
      (this.cleanupTimer as { unref: () => void }).unref();
    }
  }
}

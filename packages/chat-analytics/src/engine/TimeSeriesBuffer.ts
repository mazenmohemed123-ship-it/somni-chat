import type { TimeSeriesPoint, TimeWindow } from '../types/metrics.js';

const WINDOW_MS: Record<TimeWindow, number> = {
  minute: 60_000,
  hour: 3_600_000,
  day: 86_400_000,
  week: 604_800_000,
};

interface Entry {
  timestamp: number;
  value: number;
}

export class TimeSeriesBuffer {
  private readonly entries: Entry[] = [];
  private readonly maxEntries: number;

  constructor(maxEntries = 100_000) {
    this.maxEntries = maxEntries;
  }

  record(value = 1, timestamp = Date.now()): void {
    this.entries.push({ timestamp, value });
    if (this.entries.length > this.maxEntries) {
      this.entries.splice(0, Math.floor(this.maxEntries * 0.1));
    }
  }

  query(window: TimeWindow, now = Date.now()): TimeSeriesPoint[] {
    const cutoff = now - WINDOW_MS[window];
    return this.entries
      .filter((e) => e.timestamp >= cutoff)
      .map((e) => ({ timestamp: e.timestamp, value: e.value }));
  }

  sum(window: TimeWindow, now = Date.now()): number {
    return this.query(window, now).reduce((acc, p) => acc + p.value, 0);
  }

  count(window: TimeWindow, now = Date.now()): number {
    return this.query(window, now).length;
  }

  pruneOlderThan(window: TimeWindow, now = Date.now()): void {
    const cutoff = now - WINDOW_MS[window];
    const idx = this.entries.findIndex((e) => e.timestamp >= cutoff);
    if (idx > 0) this.entries.splice(0, idx);
    if (idx === -1) this.entries.length = 0;
  }

  get size(): number {
    return this.entries.length;
  }

  clear(): void {
    this.entries.length = 0;
  }

  all(): TimeSeriesPoint[] {
    return this.entries.map((e) => ({ timestamp: e.timestamp, value: e.value }));
  }
}

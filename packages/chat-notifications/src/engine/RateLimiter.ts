import type { RateLimitConfig } from '../types/notification.js';

interface WindowCounter {
  count: number;
  resetAt: number;
}

interface UserBucket {
  minute: WindowCounter;
  hour: WindowCounter;
  day: WindowCounter;
}

export class RateLimiter {
  private readonly config: RateLimitConfig;
  private readonly users: Map<string, UserBucket> = new Map();

  constructor(config: RateLimitConfig) {
    this.config = config;
  }

  check(userId: string): { allowed: boolean; window?: string } {
    const now = Date.now();
    const bucket = this.getOrCreate(userId, now);

    if (bucket.minute.count >= this.config.maxPerUserPerMinute) {
      return { allowed: false, window: 'minute' };
    }
    if (bucket.hour.count >= this.config.maxPerUserPerHour) {
      return { allowed: false, window: 'hour' };
    }
    if (bucket.day.count >= this.config.maxPerUserPerDay) {
      return { allowed: false, window: 'day' };
    }
    return { allowed: true };
  }

  record(userId: string): void {
    const now = Date.now();
    const bucket = this.getOrCreate(userId, now);
    bucket.minute.count++;
    bucket.hour.count++;
    bucket.day.count++;
  }

  private getOrCreate(userId: string, now: number): UserBucket {
    let bucket = this.users.get(userId);
    if (!bucket) {
      bucket = this.freshBucket(now);
      this.users.set(userId, bucket);
      return bucket;
    }
    if (now >= bucket.minute.resetAt) {
      bucket.minute = { count: 0, resetAt: now + 60_000 };
    }
    if (now >= bucket.hour.resetAt) {
      bucket.hour = { count: 0, resetAt: now + 3_600_000 };
    }
    if (now >= bucket.day.resetAt) {
      bucket.day = { count: 0, resetAt: now + 86_400_000 };
    }
    return bucket;
  }

  private freshBucket(now: number): UserBucket {
    return {
      minute: { count: 0, resetAt: now + 60_000 },
      hour: { count: 0, resetAt: now + 3_600_000 },
      day: { count: 0, resetAt: now + 86_400_000 },
    };
  }

  reset(userId: string): void {
    this.users.delete(userId);
  }

  clear(): void {
    this.users.clear();
  }

  getCounters(userId: string): UserBucket | undefined {
    return this.users.get(userId);
  }
}

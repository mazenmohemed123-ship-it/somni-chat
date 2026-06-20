export interface BackoffConfig {
  /** Base delay in ms for the first retry (default: 1000) */
  baseDelayMs: number;
  /** Hard ceiling for any single delay (default: 30000) */
  maxDelayMs: number;
  /** Max number of attempts before giving up (default: 10) */
  maxAttempts: number;
  /** Jitter ratio 0..1 applied as ± of the computed delay (default: 0.3) */
  jitter?: number;
}

export const DEFAULT_BACKOFF: BackoffConfig = {
  baseDelayMs: 1000,
  maxDelayMs: 30_000,
  maxAttempts: 10,
  jitter: 0.3,
};

/**
 * Computes a capped exponential backoff delay with full ± jitter.
 *
 * delay = min(base * 2^(attempt-1), max), then randomised within ±jitter
 * to avoid thundering-herd "reconnect storms" where every client retries
 * at the exact same instant.
 *
 * @param attempt 1-based attempt number
 */
export function computeBackoff(attempt: number, config: BackoffConfig): number {
  const { baseDelayMs, maxDelayMs, jitter = 0.3 } = config;
  const raw = baseDelayMs * 2 ** Math.max(0, attempt - 1);
  const capped = Math.min(raw, maxDelayMs);
  if (jitter <= 0) return capped;
  const delta = capped * jitter;
  const randomized = capped - delta + Math.random() * (2 * delta);
  return Math.max(0, Math.round(randomized));
}

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

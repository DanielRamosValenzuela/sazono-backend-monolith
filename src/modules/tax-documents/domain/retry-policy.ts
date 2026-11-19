export const MAX_BACKOFF_MS = 60 * 60 * 1000;
export const MAX_AUTOMATIC_DELAY_MS = 12 * 60 * 60 * 1000;
export const DEDUPE_SAFE_WINDOW_MS = 20 * 60 * 60 * 1000;
export const DEDUPE_REVIEW_CODE = 'REQUIRES_MANUAL_REVIEW_DEDUPE_WINDOW';

export function isOutsideDedupeWindow(createdAt: Date, now: Date): boolean {
  return now.getTime() - createdAt.getTime() > DEDUPE_SAFE_WINDOW_MS;
}

export function computeBackoffMs(attempts: number, baseMs: number): number {
  const exponent = Math.max(attempts - 1, 0);

  return Math.min(baseMs * 2 ** exponent, MAX_BACKOFF_MS);
}

export function isExhausted(attempts: number, maxAttempts: number): boolean {
  return attempts >= maxAttempts;
}

export function computeNextAttemptAt(
  now: Date,
  attempts: number,
  baseMs: number,
  maxAttempts: number,
  retryAfterMs?: number,
): Date | null {
  if (isExhausted(attempts, maxAttempts)) {
    return null;
  }

  const delay = Math.min(
    Math.max(computeBackoffMs(attempts, baseMs), retryAfterMs ?? 0),
    MAX_AUTOMATIC_DELAY_MS,
  );

  return new Date(now.getTime() + delay);
}

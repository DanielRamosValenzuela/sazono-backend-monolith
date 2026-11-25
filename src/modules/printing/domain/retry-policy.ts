export const PRINT_MAX_BACKOFF_MS = 2 * 60 * 1000;

export function computePrintBackoffMs(
  attempts: number,
  baseMs: number,
): number {
  const exponent = Math.max(attempts - 1, 0);

  return Math.min(baseMs * 2 ** exponent, PRINT_MAX_BACKOFF_MS);
}

export function isPrintExhausted(
  attempts: number,
  maxAttempts: number,
): boolean {
  return attempts >= maxAttempts;
}

export function computePrintNextAttemptAt(
  now: Date,
  attempts: number,
  baseMs: number,
  maxAttempts: number,
): Date | null {
  if (isPrintExhausted(attempts, maxAttempts)) {
    return null;
  }

  return new Date(now.getTime() + computePrintBackoffMs(attempts, baseMs));
}

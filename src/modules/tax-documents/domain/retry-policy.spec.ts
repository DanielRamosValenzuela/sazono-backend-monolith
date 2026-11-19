import {
  MAX_AUTOMATIC_DELAY_MS,
  MAX_BACKOFF_MS,
  computeBackoffMs,
  computeNextAttemptAt,
  isExhausted,
  isOutsideDedupeWindow,
} from './retry-policy';

describe('retry policy', () => {
  it('doubles the delay per attempt and caps it at one hour', () => {
    expect(computeBackoffMs(1, 30_000)).toBe(30_000);
    expect(computeBackoffMs(2, 30_000)).toBe(60_000);
    expect(computeBackoffMs(4, 30_000)).toBe(240_000);
    expect(computeBackoffMs(20, 30_000)).toBe(MAX_BACKOFF_MS);
  });

  it('flags exhaustion at the max attempts', () => {
    expect(isExhausted(7, 8)).toBe(false);
    expect(isExhausted(8, 8)).toBe(true);
  });

  it('returns null when exhausted and the delayed date otherwise', () => {
    const now = new Date('2026-11-19T12:00:00Z');

    expect(computeNextAttemptAt(now, 8, 30_000, 8)).toBeNull();
    expect(computeNextAttemptAt(now, 2, 30_000, 8)?.toISOString()).toBe(
      '2026-11-19T12:01:00.000Z',
    );
  });

  it('caps an enormous retry-after below the dedupe window', () => {
    const now = new Date('2026-11-19T12:00:00Z');

    expect(
      computeNextAttemptAt(now, 1, 30_000, 8, 48 * 3_600_000)?.getTime(),
    ).toBe(now.getTime() + MAX_AUTOMATIC_DELAY_MS);
  });

  it('flags documents older than 20 hours as outside the dedupe window', () => {
    const now = new Date('2026-11-19T12:00:00Z');

    expect(isOutsideDedupeWindow(new Date('2026-11-19T00:00:00Z'), now)).toBe(
      false,
    );
    expect(isOutsideDedupeWindow(new Date('2026-11-18T10:00:00Z'), now)).toBe(
      true,
    );
  });

  it('honours a longer retry-after from the provider', () => {
    const now = new Date('2026-11-19T12:00:00Z');

    expect(
      computeNextAttemptAt(now, 1, 30_000, 8, 120_000)?.toISOString(),
    ).toBe('2026-11-19T12:02:00.000Z');
  });
});

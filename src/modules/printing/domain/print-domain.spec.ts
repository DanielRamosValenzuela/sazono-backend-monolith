import { PrintJobStatus } from '@prisma/client';
import {
  businessDateKey,
  formatDisplayNumber,
  formatLocalDateTime,
} from './business-day';
import { canTransitionPrintJob, decideFailure } from './print-job-state';
import {
  computePrintBackoffMs,
  computePrintNextAttemptAt,
  PRINT_MAX_BACKOFF_MS,
} from './retry-policy';
import {
  isAllowedTcpAddress,
  isAmbiguousNumericHost,
  isAllowedTcpPort,
  parseTcpConnection,
} from './tcp-target';

describe('business day', () => {
  it('cuts the business day at the configured hour in the restaurant timezone', () => {
    const tz = 'America/Santiago';
    const before = new Date('2026-11-25T06:59:00.000Z');
    const after = new Date('2026-11-25T07:00:00.000Z');

    expect(formatLocalDateTime(before, tz)).toBe('25/11/2026 03:59');
    expect(businessDateKey(before, tz, 4)).toBe('2026-11-24');
    expect(businessDateKey(after, tz, 4)).toBe('2026-11-25');
    expect(businessDateKey(before, tz, 0)).toBe('2026-11-25');
  });

  it('falls back to the default timezone when invalid', () => {
    expect(
      formatLocalDateTime(new Date('2026-11-25T17:32:00Z'), 'Nope/Zone'),
    ).toBe('25/11/2026 14:32');
  });

  it('formats the display number with at least three digits', () => {
    expect(formatDisplayNumber('01', 23)).toBe('#01-023');
    expect(formatDisplayNumber('A', 1000)).toBe('#A-1000');
  });
});

describe('retry policy', () => {
  it('backs off exponentially up to the cap and exhausts', () => {
    expect(computePrintBackoffMs(1, 5000)).toBe(5000);
    expect(computePrintBackoffMs(3, 5000)).toBe(20000);
    expect(computePrintBackoffMs(10, 5000)).toBe(PRINT_MAX_BACKOFF_MS);

    const now = new Date('2026-11-25T10:00:00Z');

    expect(computePrintNextAttemptAt(now, 1, 5000, 6)?.getTime()).toBe(
      now.getTime() + 5000,
    );
    expect(computePrintNextAttemptAt(now, 6, 5000, 6)).toBeNull();
  });
});

describe('print job state machine', () => {
  it('allows only valid transitions', () => {
    expect(
      canTransitionPrintJob(PrintJobStatus.PENDING, PrintJobStatus.CLAIMED),
    ).toBe(true);
    expect(
      canTransitionPrintJob(PrintJobStatus.CLAIMED, PrintJobStatus.PRINTED),
    ).toBe(true);
    expect(
      canTransitionPrintJob(PrintJobStatus.FAILED, PrintJobStatus.PENDING),
    ).toBe(true);
    expect(
      canTransitionPrintJob(PrintJobStatus.PRINTED, PrintJobStatus.PENDING),
    ).toBe(false);
    expect(
      canTransitionPrintJob(PrintJobStatus.PENDING, PrintJobStatus.PRINTED),
    ).toBe(false);
    expect(
      canTransitionPrintJob(PrintJobStatus.CANCELLED, PrintJobStatus.CLAIMED),
    ).toBe(false);
  });

  it('retries while attempts remain and fails when exhausted or not retryable', () => {
    const base = {
      now: new Date('2026-11-25T10:00:00Z'),
      baseMs: 5000,
      maxAttempts: 6,
    };

    expect(
      decideFailure({ ...base, retryable: true, attempts: 2 }).status,
    ).toBe('PENDING');
    expect(
      decideFailure({ ...base, retryable: true, attempts: 6 }).status,
    ).toBe('FAILED');
    expect(
      decideFailure({ ...base, retryable: false, attempts: 1 }).status,
    ).toBe('FAILED');
  });
});

describe('tcp target guard', () => {
  it('accepts private ranges and rejects public, metadata and loopback in production', () => {
    expect(isAllowedTcpAddress('192.168.1.50', false)).toBe(true);
    expect(isAllowedTcpAddress('10.0.0.5', false)).toBe(true);
    expect(isAllowedTcpAddress('172.20.0.5', false)).toBe(true);
    expect(isAllowedTcpAddress('172.32.0.5', false)).toBe(false);
    expect(isAllowedTcpAddress('8.8.8.8', false)).toBe(false);
    expect(isAllowedTcpAddress('169.254.169.254', true)).toBe(false);
    expect(isAllowedTcpAddress('127.0.0.1', false)).toBe(false);
    expect(isAllowedTcpAddress('127.0.0.1', true)).toBe(true);
  });

  it('rejects unspecified, broadcast, multicast and reserved addresses even when local is allowed', () => {
    for (const address of [
      '0.0.0.0',
      '0.1.2.3',
      '255.255.255.255',
      '224.0.0.1',
      '239.255.255.250',
      '240.0.0.1',
      '100.64.0.1',
      '192.0.2.1',
      '::',
      'ff02::1',
      '::ffff:192.168.1.5',
      'not-an-ip',
    ]) {
      expect(isAllowedTcpAddress(address, true)).toBe(false);
      expect(isAllowedTcpAddress(address, false)).toBe(false);
    }

    expect(isAllowedTcpAddress('::1', true)).toBe(true);
    expect(isAllowedTcpAddress('::1', false)).toBe(false);
  });

  it('flags numeric host spellings that resolvers would reinterpret', () => {
    expect(isAmbiguousNumericHost('2130706433')).toBe(true);
    expect(isAmbiguousNumericHost('0x7f.1')).toBe(true);
    expect(isAmbiguousNumericHost('127.1')).toBe(true);
    expect(isAmbiguousNumericHost('192.168.1.5')).toBe(false);
    expect(isAmbiguousNumericHost('printer.local')).toBe(false);
  });

  it('limits ports and parses connections', () => {
    expect(isAllowedTcpPort(9100)).toBe(true);
    expect(isAllowedTcpPort(9110)).toBe(true);
    expect(isAllowedTcpPort(22)).toBe(false);
    expect(parseTcpConnection({ host: ' 192.168.1.5 ', port: '9100' })).toEqual(
      {
        host: '192.168.1.5',
        port: 9100,
      },
    );
    expect(parseTcpConnection({ host: '', port: 9100 })).toBeNull();
    expect(parseTcpConnection(null)).toBeNull();
  });
});

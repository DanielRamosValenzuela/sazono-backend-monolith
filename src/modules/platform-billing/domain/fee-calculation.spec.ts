import { Prisma } from '@prisma/client';
import {
  computeFee,
  isPeriod,
  periodBounds,
  shiftPeriod,
} from './fee-calculation';

const D = (value: number | string): Prisma.Decimal => new Prisma.Decimal(value);

const base = {
  gross: D(0),
  refunds: D(0),
  discounts: D(0),
  carryOverIn: D(0),
  feeBps: 100,
};

describe('computeFee', () => {
  it('applies feeBps over net sales', () => {
    const result = computeFee({ ...base, gross: D(1_000_000) });

    expect(result.netSales.toString()).toBe('1000000');
    expect(result.feeAmount.toString()).toBe('10000');
    expect(result.carryOverOut.toString()).toBe('0');
  });

  it('rounds half up to integer CLP', () => {
    expect(computeFee({ ...base, gross: D(150) }).feeAmount.toString()).toBe(
      '2',
    );
    expect(computeFee({ ...base, gross: D(149) }).feeAmount.toString()).toBe(
      '1',
    );
    expect(computeFee({ ...base, gross: D(50) }).feeAmount.toString()).toBe(
      '1',
    );
    expect(computeFee({ ...base, gross: D(49) }).feeAmount.toString()).toBe(
      '0',
    );
  });

  it('subtracts refunds and ignores informational discounts', () => {
    const result = computeFee({
      ...base,
      gross: D(100_000),
      refunds: D(30_000),
      discounts: D(10_000),
    });

    expect(result.netSales.toString()).toBe('70000');
    expect(result.feeAmount.toString()).toBe('700');
  });

  it('charges zero and carries a negative base to the next month', () => {
    const result = computeFee({
      ...base,
      gross: D(10_000),
      refunds: D(25_000),
    });

    expect(result.netSales.toString()).toBe('-15000');
    expect(result.feeAmount.toString()).toBe('0');
    expect(result.carryOverOut.toString()).toBe('-15000');
  });

  it('consumes the carry over of the previous month', () => {
    const result = computeFee({
      ...base,
      gross: D(100_000),
      carryOverIn: D(-15_000),
    });

    expect(result.netSales.toString()).toBe('85000');
    expect(result.feeAmount.toString()).toBe('850');
    expect(result.carryOverOut.toString()).toBe('0');
  });

  it('uses the restaurant fee bps', () => {
    expect(
      computeFee({
        ...base,
        gross: D(200_000),
        feeBps: 250,
      }).feeAmount.toString(),
    ).toBe('5000');
  });

  it('excludes tips because gross only receives consumption', () => {
    const payment = D(11_000);
    const tip = D(1_000);
    const result = computeFee({ ...base, gross: payment.minus(tip) });

    expect(result.feeAmount.toString()).toBe('100');
  });

  it('lets refunds from earlier months reduce this month', () => {
    const result = computeFee({
      ...base,
      gross: D(50_000),
      refunds: D(80_000),
    });

    expect(result.netSales.toString()).toBe('-30000');
    expect(result.feeAmount.toString()).toBe('0');
  });
});

describe('periods', () => {
  it('validates the YYYY-MM format', () => {
    expect(isPeriod('2026-09')).toBe(true);
    expect(isPeriod('2026-13')).toBe(false);
    expect(isPeriod('2026-9')).toBe(false);
    expect(isPeriod('2026-09-01')).toBe(false);
  });

  it('shifts across years', () => {
    expect(shiftPeriod('2026-01', -1)).toBe('2025-12');
    expect(shiftPeriod('2026-12', 1)).toBe('2027-01');
  });

  it('builds half-open bounds in the restaurant timezone', () => {
    const { start, end } = periodBounds('2026-09', 'America/Santiago');

    expect(start.toISOString()).toBe('2026-09-01T04:00:00.000Z');
    expect(end.toISOString()).toBe('2026-10-01T03:00:00.000Z');
  });

  it('keeps 23:30 of the last local day inside the month although UTC is next month', () => {
    const { start, end } = periodBounds('2026-09', 'America/Santiago');
    const lastNight = new Date('2026-10-01T02:30:00.000Z');

    expect(lastNight.getUTCMonth()).toBe(9);
    expect(lastNight >= start && lastNight < end).toBe(true);
    expect(new Date('2026-10-01T03:00:00.000Z') < end).toBe(false);
  });

  it('puts local midnight of day 1 in the new month', () => {
    const { start } = periodBounds('2026-09', 'America/Santiago');

    expect(new Date('2026-09-01T03:59:59.999Z') < start).toBe(true);
    expect(new Date('2026-09-01T04:00:00.000Z') >= start).toBe(true);
  });
});

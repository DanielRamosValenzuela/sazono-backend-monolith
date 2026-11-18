import { Prisma } from '@prisma/client';
import { zonedStartOfDay } from '../../../common/time/restaurant-time';

const PERIOD_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/;

export type FeeInput = {
  gross: Prisma.Decimal;
  refunds: Prisma.Decimal;
  discounts: Prisma.Decimal;
  carryOverIn: Prisma.Decimal;
  feeBps: number;
};

export type FeeResult = {
  netSales: Prisma.Decimal;
  feeAmount: Prisma.Decimal;
  carryOverOut: Prisma.Decimal;
};

export function isPeriod(value: string): boolean {
  return PERIOD_PATTERN.test(value);
}

export function shiftPeriod(period: string, months: number): string {
  const match = PERIOD_PATTERN.exec(period);

  if (!match) {
    throw new Error(`Periodo invalido: ${period}`);
  }

  const index = Number(match[1]) * 12 + (Number(match[2]) - 1) + months;
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;

  return `${year}-${String(month).padStart(2, '0')}`;
}

export function periodBounds(
  period: string,
  timeZone: string,
): { start: Date; end: Date } {
  return {
    start: zonedStartOfDay(`${period}-01`, timeZone),
    end: zonedStartOfDay(`${shiftPeriod(period, 1)}-01`, timeZone),
  };
}

export function computeFee(input: FeeInput): FeeResult {
  const netSales = input.gross.minus(input.refunds).plus(input.carryOverIn);
  const base = netSales.isNegative() ? new Prisma.Decimal(0) : netSales;

  return {
    netSales,
    feeAmount: base
      .mul(input.feeBps)
      .div(10000)
      .toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP),
    carryOverOut: netSales.isNegative() ? netSales : new Prisma.Decimal(0),
  };
}

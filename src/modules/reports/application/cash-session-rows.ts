import { Prisma } from '@prisma/client';
import type { DailyZCashSessionRecord } from '../infrastructure/daily-z.prisma.repository';
import { money } from './insights-shared';

export type CashSessionRow = {
  id: string;
  registerLabel: string;
  status: string;
  staffUserId: string;
  name: string | null;
  openedAt: string;
  closedAt: string | null;
  forced: boolean;
  openingFloat: string;
  cashSales: string;
  movements: string;
  expectedCash: string;
  countedCash: string | null;
  difference: string | null;
  closingNote: string | null;
};

export function buildCashSessionRows(
  records: DailyZCashSessionRecord[],
): CashSessionRow[] {
  return records.map((record) => {
    const expected = new Prisma.Decimal(record.opening_float)
      .add(record.cash_sales)
      .add(record.movements);

    return {
      id: record.id,
      registerLabel: record.register_label,
      status: record.status,
      staffUserId: record.staff_id,
      name: record.name,
      openedAt: record.opened_at.toISOString(),
      closedAt: record.closed_at?.toISOString() ?? null,
      forced: record.forced,
      openingFloat: money(record.opening_float),
      cashSales: money(record.cash_sales),
      movements: money(record.movements),
      expectedCash: money(expected),
      countedCash:
        record.counted_cash === null ? null : money(record.counted_cash),
      difference: record.difference === null ? null : money(record.difference),
      closingNote: record.closing_note,
    };
  });
}

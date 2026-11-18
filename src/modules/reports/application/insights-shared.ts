import { Readable } from 'node:stream';
import { Prisma } from '@prisma/client';
import type { JwtPayload } from '../../auth/interfaces/jwt-payload.interface';
import type { BillFilter } from '../infrastructure/report-sql';
import type { CsvDownload } from './get-sales-by-order.service';
import { csvStream, type CsvCell } from './report-csv';
import type {
  ReportScopeQuery,
  ReportScopeService,
} from './report-scope.service';
import type { ReportScope } from './report-types';

export const ZERO = new Prisma.Decimal(0);

export function money(value: Prisma.Decimal.Value): string {
  return new Prisma.Decimal(value).toFixed(0);
}

export function ratio(
  numerator: Prisma.Decimal.Value,
  denominator: Prisma.Decimal.Value,
  decimals: number,
): string {
  const divisor = new Prisma.Decimal(denominator);

  if (divisor.isZero()) {
    return new Prisma.Decimal(0).toFixed(decimals);
  }

  return new Prisma.Decimal(numerator)
    .div(divisor)
    .toDecimalPlaces(decimals, Prisma.Decimal.ROUND_HALF_UP)
    .toFixed(decimals);
}

export function percent(
  part: Prisma.Decimal.Value,
  whole: Prisma.Decimal.Value,
): number {
  return Number(
    new Prisma.Decimal(ratio(new Prisma.Decimal(part).mul(100), whole, 2)),
  );
}

export function toBillFilter(scope: ReportScope): BillFilter {
  return {
    ...scope.filters,
    branchId: scope.branchId,
    start: scope.start,
    end: scope.end,
    timeZone: scope.timeZone,
    cashierId: scope.cashierId,
    methods: scope.methods,
  };
}

export function rowsCsv(
  filename: string,
  headers: string[],
  rows: CsvCell[][],
): CsvDownload {
  const lines = Readable.from(rows) as AsyncIterable<CsvCell[]>;

  return { filename, stream: csvStream(headers, lines) };
}

export type InsightsQuery = ReportScopeQuery & {
  minTotal?: number;
  maxTotal?: number;
};

export function resolveInsightsScope(
  scopeService: ReportScopeService,
  authUser: JwtPayload,
  branchId: string,
  query: InsightsQuery,
  forCsv: boolean,
): Promise<ReportScope> {
  return scopeService.resolve(
    authUser,
    branchId,
    { ...query, minAmount: query.minTotal, maxAmount: query.maxTotal },
    { forCsv },
  );
}

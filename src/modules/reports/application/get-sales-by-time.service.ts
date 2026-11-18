import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  addDaysToDateKey,
  daysBetweenDateKeys,
} from '../../../common/time/restaurant-time';
import type { JwtPayload } from '../../auth/interfaces/jwt-payload.interface';
import {
  ReportsInsightsPrismaRepository,
  type HourWeekdayRecord,
  type PeriodBucketRecord,
  type TimeBucket,
} from '../infrastructure/reports-insights.prisma.repository';
import type { CsvDownload } from './get-sales-by-order.service';
import {
  ZERO,
  money,
  ratio,
  resolveInsightsScope,
  rowsCsv,
  toBillFilter,
  type InsightsQuery,
} from './insights-shared';
import { ReportScopeService } from './report-scope.service';
import type { ReportScope } from './report-types';

export type SalesByTimeQuery = InsightsQuery & { bucket?: TimeBucket };

export type SalesByTimeTotals = {
  bills: number;
  guests: number;
  amount: string;
  refunded: string;
  net: string;
  averageTicket: string;
  tip: string;
};

export type SalesByTimeRow = SalesByTimeTotals & {
  key: string;
  label: string;
};

export type SalesByTimeHeatmap = {
  weekdays: string[];
  hours: number[];
  amount: string[][];
  bills: number[][];
};

export type SalesByTimeResponse = {
  bucket: TimeBucket;
  from: string;
  to: string;
  timeZone: string;
  cashierId: string | null;
  rows: SalesByTimeRow[];
  totals: SalesByTimeTotals;
  heatmap: SalesByTimeHeatmap | null;
};

export const WEEKDAY_LABELS = [
  'Lunes',
  'Martes',
  'Miercoles',
  'Jueves',
  'Viernes',
  'Sabado',
  'Domingo',
];

export const SALES_BY_TIME_CSV_HEADERS = [
  'Periodo',
  'Cuentas',
  'Comensales',
  'Monto',
  'Reembolsado',
  'Neto',
  'Ticket promedio',
  'Propina',
];

type Cell = {
  bills: number;
  guests: number;
  amount: Prisma.Decimal;
  tip: Prisma.Decimal;
  refunded: Prisma.Decimal;
};

const emptyCell = (): Cell => ({
  bills: 0,
  guests: 0,
  amount: ZERO,
  tip: ZERO,
  refunded: ZERO,
});

function addCell(target: Cell, source: Cell): Cell {
  return {
    bills: target.bills + source.bills,
    guests: target.guests + source.guests,
    amount: target.amount.add(source.amount),
    tip: target.tip.add(source.tip),
    refunded: target.refunded.add(source.refunded),
  };
}

function toCell(record: {
  bills: number;
  guests: number;
  amount: Prisma.Decimal.Value;
  tip: Prisma.Decimal.Value;
  refunded: Prisma.Decimal.Value;
}): Cell {
  return {
    bills: record.bills,
    guests: record.guests,
    amount: new Prisma.Decimal(record.amount),
    tip: new Prisma.Decimal(record.tip),
    refunded: new Prisma.Decimal(record.refunded),
  };
}

function netOf(cell: Cell): Prisma.Decimal {
  return cell.amount.sub(cell.refunded);
}

function toTotals(cell: Cell): SalesByTimeTotals {
  return {
    bills: cell.bills,
    guests: cell.guests,
    amount: money(cell.amount),
    refunded: money(cell.refunded),
    net: money(netOf(cell)),
    averageTicket: ratio(netOf(cell), cell.bills, 0),
    tip: money(cell.tip),
  };
}

function toRow(key: string, label: string, cell: Cell): SalesByTimeRow {
  return { key, label, ...toTotals(cell) };
}

function monthKeys(from: string, to: string): string[] {
  const keys: string[] = [];
  let year = Number(from.slice(0, 4));
  let month = Number(from.slice(5, 7));
  const lastYear = Number(to.slice(0, 4));
  const lastMonth = Number(to.slice(5, 7));

  while (year < lastYear || (year === lastYear && month <= lastMonth)) {
    keys.push(`${year}-${String(month).padStart(2, '0')}`);
    month += 1;

    if (month > 12) {
      month = 1;
      year += 1;
    }
  }

  return keys;
}

function dayKeys(from: string, to: string): string[] {
  return Array.from({ length: daysBetweenDateKeys(from, to) + 1 }, (_, index) =>
    addDaysToDateKey(from, index),
  );
}

export function buildHourWeekday(
  records: HourWeekdayRecord[],
  bucket: 'hour' | 'weekday',
): Pick<SalesByTimeResponse, 'rows' | 'heatmap'> {
  const grid = Array.from({ length: 7 }, () =>
    Array.from({ length: 24 }, emptyCell),
  );

  for (const record of records) {
    grid[record.weekday - 1][record.hour] = toCell(record);
  }

  const rows =
    bucket === 'hour'
      ? Array.from({ length: 24 }, (_, hour) => {
          const key = String(hour).padStart(2, '0');

          return toRow(
            key,
            `${key}:00`,
            grid.reduce((total, day) => addCell(total, day[hour]), emptyCell()),
          );
        })
      : grid.map((day, index) =>
          toRow(
            String(index + 1),
            WEEKDAY_LABELS[index],
            day.reduce(addCell, emptyCell()),
          ),
        );

  return {
    rows,
    heatmap: {
      weekdays: WEEKDAY_LABELS,
      hours: Array.from({ length: 24 }, (_, hour) => hour),
      amount: grid.map((day) => day.map((cell) => money(netOf(cell)))),
      bills: grid.map((day) => day.map((cell) => cell.bills)),
    },
  };
}

export function buildPeriods(
  records: PeriodBucketRecord[],
  bucket: 'day' | 'month',
  from: string,
  to: string,
): SalesByTimeRow[] {
  const byKey = new Map(records.map((record) => [record.bucket, record]));
  const keys =
    bucket === 'day'
      ? dayKeys(from, to)
      : monthKeys(from.slice(0, 7), to.slice(0, 7));

  return keys.map((key) => {
    const record = byKey.get(key);

    return toRow(
      key,
      key.split('-').reverse().join('-'),
      record ? toCell(record) : emptyCell(),
    );
  });
}

export function sumTimeRows(rows: SalesByTimeRow[]): SalesByTimeTotals {
  return toTotals(
    rows.reduce(
      (total, row) =>
        addCell(total, {
          bills: row.bills,
          guests: row.guests,
          amount: new Prisma.Decimal(row.amount),
          tip: new Prisma.Decimal(row.tip),
          refunded: new Prisma.Decimal(row.refunded),
        }),
      emptyCell(),
    ),
  );
}

@Injectable()
export class GetSalesByTimeService {
  constructor(
    private readonly scopeService: ReportScopeService,
    private readonly insightsRepository: ReportsInsightsPrismaRepository,
  ) {}

  async execute(
    authUser: JwtPayload,
    branchId: string,
    query: SalesByTimeQuery,
  ): Promise<SalesByTimeResponse> {
    const bucket = query.bucket ?? 'hour';
    const scope = await resolveInsightsScope(
      this.scopeService,
      authUser,
      branchId,
      query,
      false,
    );
    const { rows, heatmap } = await this.build(scope, bucket);

    return {
      bucket,
      from: scope.from,
      to: scope.to,
      timeZone: scope.timeZone,
      cashierId: scope.cashierId,
      rows,
      totals: sumTimeRows(rows),
      heatmap,
    };
  }

  async executeCsv(
    authUser: JwtPayload,
    branchId: string,
    query: SalesByTimeQuery,
  ): Promise<CsvDownload> {
    const bucket = query.bucket ?? 'hour';
    const scope = await resolveInsightsScope(
      this.scopeService,
      authUser,
      branchId,
      query,
      true,
    );
    const { rows } = await this.build(scope, bucket);
    const totals = sumTimeRows(rows);

    return rowsCsv(
      `ventas-por-${bucket}_${branchId}_${scope.from}_${scope.to}.csv`,
      SALES_BY_TIME_CSV_HEADERS,
      [
        ...rows.map((row) => [
          row.label,
          row.bills,
          row.guests,
          Number(row.amount),
          Number(row.refunded),
          Number(row.net),
          Number(row.averageTicket),
          Number(row.tip),
        ]),
        [
          'TOTAL',
          totals.bills,
          totals.guests,
          Number(totals.amount),
          Number(totals.refunded),
          Number(totals.net),
          Number(totals.averageTicket),
          Number(totals.tip),
        ],
      ],
    );
  }

  private async build(
    scope: ReportScope,
    bucket: TimeBucket,
  ): Promise<Pick<SalesByTimeResponse, 'rows' | 'heatmap'>> {
    const filter = toBillFilter(scope);

    if (bucket === 'hour' || bucket === 'weekday') {
      return buildHourWeekday(
        await this.insightsRepository.findHourWeekday(filter),
        bucket,
      );
    }

    return {
      rows: buildPeriods(
        await this.insightsRepository.findPeriodBuckets(filter, bucket),
        bucket,
        scope.from,
        scope.to,
      ),
      heatmap: null,
    };
  }
}

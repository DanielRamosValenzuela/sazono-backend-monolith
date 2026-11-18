import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  addDaysToDateKey,
  daysBetweenDateKeys,
  zonedStartOfDay,
} from '../../../common/time/restaurant-time';
import type { JwtPayload } from '../../auth/interfaces/jwt-payload.interface';
import {
  ReportsInsightsPrismaRepository,
  type KpiTotalsRecord,
} from '../infrastructure/reports-insights.prisma.repository';
import type { CsvDownload } from './get-sales-by-order.service';
import {
  money,
  ratio,
  resolveInsightsScope,
  rowsCsv,
  toBillFilter,
  type InsightsQuery,
} from './insights-shared';
import { ReportScopeService } from './report-scope.service';
import type { ReportScope } from './report-types';

export const KPI_COMPARES = ['previous'] as const;
export type KpiCompare = (typeof KPI_COMPARES)[number];

export type SummaryKpisQuery = InsightsQuery & { compare?: KpiCompare };

export type KpiBlock = {
  grossSales: string;
  refunded: string;
  netSales: string;
  tips: string;
  bills: number;
  averageTicket: string;
  guests: number;
  tablesTurnover: string | null;
};

export type KpiKey = keyof KpiBlock;

export type KpiDelta = { absolute: string; percent: number | null };

export type SummaryKpisResponse = {
  from: string;
  to: string;
  timeZone: string;
  cashierId: string | null;
  current: KpiBlock;
  previousRange: { from: string; to: string } | null;
  previous: KpiBlock | null;
  delta: Record<KpiKey, KpiDelta | null> | null;
};

export const KPI_KEYS: KpiKey[] = [
  'grossSales',
  'refunded',
  'netSales',
  'tips',
  'bills',
  'averageTicket',
  'guests',
  'tablesTurnover',
];

export const KPI_LABELS: Record<KpiKey, string> = {
  grossSales: 'Venta bruta',
  refunded: 'Reembolsado',
  netSales: 'Venta neta',
  tips: 'Propinas',
  bills: 'Cuentas',
  averageTicket: 'Ticket promedio',
  guests: 'Comensales',
  tablesTurnover: 'Rotacion de mesas por dia',
};

export const SUMMARY_KPIS_CSV_HEADERS = [
  'Indicador',
  'Actual',
  'Anterior',
  'Variacion',
  'Variacion %',
];

export function buildKpiBlock(
  record: KpiTotalsRecord,
  physicalTables: number,
  days: number,
): KpiBlock {
  const gross = new Prisma.Decimal(record.gross);
  const refunded = new Prisma.Decimal(record.refunded);
  const net = gross.sub(refunded);

  return {
    grossSales: money(gross),
    refunded: money(refunded),
    netSales: money(net),
    tips: money(record.tip),
    bills: record.bills,
    averageTicket: ratio(net, record.bills, 0),
    guests: record.guests,
    tablesTurnover:
      physicalTables > 0
        ? ratio(record.table_bills, physicalTables * days, 2)
        : null,
  };
}

function numeric(block: KpiBlock, key: KpiKey): Prisma.Decimal | null {
  const value = block[key];

  return value === null ? null : new Prisma.Decimal(value);
}

export function buildDeltas(
  current: KpiBlock,
  previous: KpiBlock,
): Record<KpiKey, KpiDelta | null> {
  return Object.fromEntries(
    KPI_KEYS.map((key) => {
      const now = numeric(current, key);
      const before = numeric(previous, key);

      if (now === null || before === null) {
        return [key, null];
      }

      const difference = now.sub(before);
      const decimals = key === 'tablesTurnover' ? 2 : 0;

      return [
        key,
        {
          absolute: difference.toFixed(decimals),
          percent: before.isZero()
            ? null
            : Number(ratio(difference.mul(100), before.abs(), 2)),
        },
      ];
    }),
  ) as Record<KpiKey, KpiDelta | null>;
}

export function previousScope(scope: ReportScope): ReportScope {
  const days = daysBetweenDateKeys(scope.from, scope.to) + 1;
  const from = addDaysToDateKey(scope.from, -days);
  const to = addDaysToDateKey(scope.from, -1);

  return {
    ...scope,
    from,
    to,
    start: zonedStartOfDay(from, scope.timeZone),
    end: scope.start,
  };
}

@Injectable()
export class GetSummaryKpisService {
  constructor(
    private readonly scopeService: ReportScopeService,
    private readonly insightsRepository: ReportsInsightsPrismaRepository,
  ) {}

  async execute(
    authUser: JwtPayload,
    branchId: string,
    query: SummaryKpisQuery,
  ): Promise<SummaryKpisResponse> {
    const scope = await resolveInsightsScope(
      this.scopeService,
      authUser,
      branchId,
      query,
      false,
    );

    return this.build(scope, query.compare === 'previous');
  }

  async executeCsv(
    authUser: JwtPayload,
    branchId: string,
    query: SummaryKpisQuery,
  ): Promise<CsvDownload> {
    const scope = await resolveInsightsScope(
      this.scopeService,
      authUser,
      branchId,
      query,
      true,
    );
    const response = await this.build(scope, query.compare === 'previous');

    return rowsCsv(
      `indicadores_${branchId}_${scope.from}_${scope.to}.csv`,
      SUMMARY_KPIS_CSV_HEADERS,
      KPI_KEYS.map((key) => {
        const delta = response.delta?.[key] ?? null;
        const current = response.current[key];
        const previous = response.previous?.[key] ?? null;

        return [
          KPI_LABELS[key],
          current === null ? null : Number(current),
          previous === null ? null : Number(previous),
          delta ? Number(delta.absolute) : null,
          delta?.percent ?? null,
        ];
      }),
    );
  }

  private async build(
    scope: ReportScope,
    withPrevious: boolean,
  ): Promise<SummaryKpisResponse> {
    const compare = withPrevious && !scope.cashierScoped;
    const before = previousScope(scope);
    const [tables, currentTotals, previousTotals] = await Promise.all([
      this.insightsRepository.countPhysicalTables(scope.branchId),
      this.insightsRepository.findKpiTotals(toBillFilter(scope)),
      compare
        ? this.insightsRepository.findKpiTotals(toBillFilter(before))
        : Promise.resolve(null),
    ]);
    const days = daysBetweenDateKeys(scope.from, scope.to) + 1;
    const current = buildKpiBlock(currentTotals, tables, days);
    const previous = previousTotals
      ? buildKpiBlock(previousTotals, tables, days)
      : null;

    return {
      from: scope.from,
      to: scope.to,
      timeZone: scope.timeZone,
      cashierId: scope.cashierId,
      current,
      previousRange: previous ? { from: before.from, to: before.to } : null,
      previous,
      delta: previous ? buildDeltas(current, previous) : null,
    };
  }
}

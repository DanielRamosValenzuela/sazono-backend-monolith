import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { JwtPayload } from '../../auth/interfaces/jwt-payload.interface';
import {
  ReportsInsightsPrismaRepository,
  type MethodBreakdownRecord,
} from '../infrastructure/reports-insights.prisma.repository';
import type { CsvDownload } from './get-sales-by-order.service';
import {
  ZERO,
  money,
  percent,
  resolveInsightsScope,
  rowsCsv,
  toBillFilter,
  type InsightsQuery,
} from './insights-shared';
import { ReportScopeService } from './report-scope.service';
import { METHOD_KEYS, METHOD_LABELS, type MethodKey } from './report-types';

export type SalesByMethodRow = {
  method: MethodKey;
  label: string;
  count: number;
  bills: number;
  amount: string;
  tip: string;
  refunded: string;
  net: string;
  share: number;
};

export type SalesByMethodTotals = {
  count: number;
  amount: string;
  tip: string;
  refunded: string;
  net: string;
};

export type SalesByMethodResponse = {
  from: string;
  to: string;
  timeZone: string;
  cashierId: string | null;
  rows: SalesByMethodRow[];
  totals: SalesByMethodTotals;
};

export const SALES_BY_METHOD_CSV_HEADERS = [
  'Medio de pago',
  'N° pagos',
  'Monto',
  'Propina',
  'Reembolsado',
  'Neto',
  'Participacion %',
];

export function buildSalesByMethod(
  records: MethodBreakdownRecord[],
): Pick<SalesByMethodResponse, 'rows' | 'totals'> {
  const lines = records
    .map((record) => {
      const amount = new Prisma.Decimal(record.amount);
      const refunded = new Prisma.Decimal(record.refunded);

      return {
        record,
        amount,
        tip: new Prisma.Decimal(record.tip),
        refunded,
        net: amount.sub(refunded),
      };
    })
    .sort(
      (a, b) =>
        b.net.comparedTo(a.net) ||
        METHOD_KEYS.indexOf(a.record.method as MethodKey) -
          METHOD_KEYS.indexOf(b.record.method as MethodKey),
    );
  const sum = (pick: (line: (typeof lines)[number]) => Prisma.Decimal) =>
    lines.reduce((total, line) => total.add(pick(line)), ZERO);
  const net = sum((line) => line.net);

  return {
    rows: lines.map((line) => ({
      method: line.record.method as MethodKey,
      label: METHOD_LABELS[line.record.method as MethodKey],
      count: line.record.payments,
      bills: line.record.bills,
      amount: money(line.amount),
      tip: money(line.tip),
      refunded: money(line.refunded),
      net: money(line.net),
      share: percent(line.net, net),
    })),
    totals: {
      count: lines.reduce((total, line) => total + line.record.payments, 0),
      amount: money(sum((line) => line.amount)),
      tip: money(sum((line) => line.tip)),
      refunded: money(sum((line) => line.refunded)),
      net: money(net),
    },
  };
}

@Injectable()
export class GetSalesByMethodService {
  constructor(
    private readonly scopeService: ReportScopeService,
    private readonly insightsRepository: ReportsInsightsPrismaRepository,
  ) {}

  async execute(
    authUser: JwtPayload,
    branchId: string,
    query: InsightsQuery,
  ): Promise<SalesByMethodResponse> {
    const scope = await resolveInsightsScope(
      this.scopeService,
      authUser,
      branchId,
      query,
      false,
    );
    const records = await this.insightsRepository.findMethodBreakdown(
      toBillFilter(scope),
    );

    return {
      from: scope.from,
      to: scope.to,
      timeZone: scope.timeZone,
      cashierId: scope.cashierId,
      ...buildSalesByMethod(records),
    };
  }

  async executeCsv(
    authUser: JwtPayload,
    branchId: string,
    query: InsightsQuery,
  ): Promise<CsvDownload> {
    const scope = await resolveInsightsScope(
      this.scopeService,
      authUser,
      branchId,
      query,
      true,
    );
    const { rows, totals } = buildSalesByMethod(
      await this.insightsRepository.findMethodBreakdown(toBillFilter(scope)),
    );

    return rowsCsv(
      `ventas-por-medio_${branchId}_${scope.from}_${scope.to}.csv`,
      SALES_BY_METHOD_CSV_HEADERS,
      [
        ...rows.map((row) => [
          row.label,
          row.count,
          Number(row.amount),
          Number(row.tip),
          Number(row.refunded),
          Number(row.net),
          row.share,
        ]),
        [
          'TOTAL',
          totals.count,
          Number(totals.amount),
          Number(totals.tip),
          Number(totals.refunded),
          Number(totals.net),
          rows.length > 0 ? 100 : 0,
        ],
      ],
    );
  }
}

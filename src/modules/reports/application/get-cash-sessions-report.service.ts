import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { JwtPayload } from '../../auth/interfaces/jwt-payload.interface';
import { DailyZPrismaRepository } from '../infrastructure/daily-z.prisma.repository';
import { buildCashSessionRows, type CashSessionRow } from './cash-session-rows';
import type { CsvDownload } from './get-sales-by-order.service';
import {
  money,
  resolveInsightsScope,
  rowsCsv,
  type InsightsQuery,
} from './insights-shared';
import { ReportScopeService } from './report-scope.service';

export type CashSessionsResponse = {
  from: string;
  to: string;
  timeZone: string;
  cashierId: string | null;
  totals: {
    sessions: number;
    openSessions: number;
    cashSales: string;
    movements: string;
    expectedCash: string;
    countedCash: string;
    difference: string;
  };
  byCashier: Array<{
    staffUserId: string;
    name: string | null;
    sessions: number;
    difference: string;
  }>;
  sessions: CashSessionRow[];
};

export const CASH_SESSIONS_CSV_HEADERS = [
  'Caja',
  'Cajero',
  'Estado',
  'Apertura',
  'Cierre',
  'Fondo inicial',
  'Ventas efectivo',
  'Movimientos',
  'Esperado',
  'Contado',
  'Diferencia',
  'Forzado',
  'Nota',
];

export function buildCashSessionsReport(
  rows: CashSessionRow[],
): Pick<CashSessionsResponse, 'totals' | 'byCashier'> {
  const sum = (pick: (row: CashSessionRow) => string | null) =>
    rows.reduce(
      (total, row) => total.add(pick(row) ?? 0),
      new Prisma.Decimal(0),
    );
  const closed = rows.filter((row) => row.status === 'CLOSED');
  const cashiers = new Map<
    string,
    { name: string | null; sessions: number; difference: Prisma.Decimal }
  >();

  for (const row of rows) {
    const entry = cashiers.get(row.staffUserId) ?? {
      name: row.name,
      sessions: 0,
      difference: new Prisma.Decimal(0),
    };

    entry.sessions += 1;
    entry.difference = entry.difference.add(row.difference ?? 0);
    cashiers.set(row.staffUserId, entry);
  }

  return {
    totals: {
      sessions: rows.length,
      openSessions: rows.length - closed.length,
      cashSales: money(sum((row) => row.cashSales)),
      movements: money(sum((row) => row.movements)),
      expectedCash: money(sum((row) => row.expectedCash)),
      countedCash: money(sum((row) => row.countedCash)),
      difference: money(sum((row) => row.difference)),
    },
    byCashier: [...cashiers.entries()]
      .map(([staffUserId, entry]) => ({
        staffUserId,
        name: entry.name,
        sessions: entry.sessions,
        difference: money(entry.difference),
      }))
      .sort((a, b) => (a.name ?? '~').localeCompare(b.name ?? '~', 'es')),
  };
}

@Injectable()
export class GetCashSessionsReportService {
  constructor(
    private readonly scopeService: ReportScopeService,
    private readonly dailyZRepository: DailyZPrismaRepository,
  ) {}

  async execute(
    authUser: JwtPayload,
    branchId: string,
    query: InsightsQuery,
  ): Promise<CashSessionsResponse> {
    const { scope, rows } = await this.load(authUser, branchId, query, false);

    return {
      from: scope.from,
      to: scope.to,
      timeZone: scope.timeZone,
      cashierId: scope.cashierId,
      ...buildCashSessionsReport(rows),
      sessions: rows,
    };
  }

  async executeCsv(
    authUser: JwtPayload,
    branchId: string,
    query: InsightsQuery,
  ): Promise<CsvDownload> {
    const { scope, rows } = await this.load(authUser, branchId, query, true);
    const { totals } = buildCashSessionsReport(rows);

    return rowsCsv(
      `sesiones_caja_${branchId}_${scope.from}_${scope.to}.csv`,
      CASH_SESSIONS_CSV_HEADERS,
      [
        ...rows.map((row) => [
          row.registerLabel,
          row.name,
          row.status === 'OPEN' ? 'ABIERTA' : 'CERRADA',
          row.openedAt,
          row.closedAt,
          Number(row.openingFloat),
          Number(row.cashSales),
          Number(row.movements),
          Number(row.expectedCash),
          row.countedCash === null ? null : Number(row.countedCash),
          row.difference === null ? null : Number(row.difference),
          row.forced ? 'SI' : 'NO',
          row.closingNote,
        ]),
        [
          'TOTAL',
          null,
          null,
          null,
          null,
          null,
          Number(totals.cashSales),
          Number(totals.movements),
          Number(totals.expectedCash),
          Number(totals.countedCash),
          Number(totals.difference),
          null,
          null,
        ],
      ],
    );
  }

  private async load(
    authUser: JwtPayload,
    branchId: string,
    query: InsightsQuery,
    forCsv: boolean,
  ) {
    const scope = await resolveInsightsScope(
      this.scopeService,
      authUser,
      branchId,
      query,
      forCsv,
    );
    const records = await this.dailyZRepository.findCashSessions(
      branchId,
      scope.start,
      scope.end,
      scope.cashierId,
    );

    return { scope, rows: buildCashSessionRows(records) };
  }
}

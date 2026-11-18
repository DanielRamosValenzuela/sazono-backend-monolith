import { ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { formatZonedDateTime } from '../../../common/time/restaurant-time';
import type { JwtPayload } from '../../auth/interfaces/jwt-payload.interface';
import {
  ReportsInsightsPrismaRepository,
  type OpenTabKind,
  type OpenTabRecord,
  type OpenTabsFilter,
} from '../infrastructure/reports-insights.prisma.repository';
import type { CsvDownload } from './get-sales-by-order.service';
import { ZERO, money, rowsCsv } from './insights-shared';
import { parseReportFilters } from './report-filters';
import {
  ReportScopeService,
  type ReportScopeQuery,
} from './report-scope.service';

export const OPEN_TAB_ALERT_MINUTES = 180;
export const MAX_OPEN_TAB_ROWS = 500;

export type OpenTabsQuery = Pick<
  ReportScopeQuery,
  'from' | 'to' | 'waiterId' | 'tableId' | 'zoneId'
> & { kind?: OpenTabKind };

export type OpenTabRow = {
  sessionId: string;
  billId: string | null;
  orderNumber: string;
  table: string;
  zone: string | null;
  waiter: string | null;
  customerLabel: string | null;
  isCounter: boolean;
  guests: number | null;
  sessionStatus: string;
  billStatus: string | null;
  openedAt: string;
  endedAt: string | null;
  ageMinutes: number;
  total: string;
  paid: string;
  pending: string;
  alert: boolean;
  closeReason: string | null;
  cancelledOrders: number | null;
  cancelledAmount: string | null;
};

export type OpenTabsResponse = {
  kind: OpenTabKind;
  from: string | null;
  to: string | null;
  timeZone: string;
  alertAfterMinutes: number;
  rows: OpenTabRow[];
  truncated: boolean;
  totals: { count: number; pending: string; alerts: number };
};

export const OPEN_TABS_CSV_HEADERS = [
  'Comanda',
  'Mesa',
  'Zona',
  'Mesero',
  'Cliente',
  'Comensales',
  'Estado',
  'Apertura',
  'Cierre',
  'Minutos',
  'Total',
  'Pagado',
  'Pendiente',
  'Alerta',
  'Motivo',
  'Ordenes anuladas',
  'Monto anulado',
];

export function buildOpenTabRow(
  record: OpenTabRecord,
  kind: OpenTabKind,
  now: Date,
): OpenTabRow {
  const reference = record.ended_at ?? now;
  const ageMinutes = Math.max(
    0,
    Math.floor((reference.getTime() - record.opened_at.getTime()) / 60000),
  );

  return {
    sessionId: record.session_id,
    billId: record.bill_id,
    orderNumber:
      record.ticket_number?.toString() ??
      (record.bill_id ?? record.session_id).slice(-6).toUpperCase(),
    table: record.table_name,
    zone: record.zone_name,
    waiter: record.waiter_name,
    customerLabel: record.customer_label,
    isCounter: record.is_counter,
    guests: record.guest_count,
    sessionStatus: record.session_status,
    billStatus: record.bill_status,
    openedAt: record.opened_at.toISOString(),
    endedAt: record.ended_at?.toISOString() ?? null,
    ageMinutes,
    total: money(record.total),
    paid: money(record.paid),
    pending: money(record.pending),
    alert: kind === 'open' && ageMinutes > OPEN_TAB_ALERT_MINUTES,
    closeReason: record.close_reason,
    cancelledOrders: record.cancelled_orders,
    cancelledAmount:
      record.cancelled_amount === null ? null : money(record.cancelled_amount),
  };
}

@Injectable()
export class GetOpenTabsService {
  constructor(
    private readonly scopeService: ReportScopeService,
    private readonly insightsRepository: ReportsInsightsPrismaRepository,
  ) {}

  async execute(
    authUser: JwtPayload,
    branchId: string,
    query: OpenTabsQuery,
  ): Promise<OpenTabsResponse> {
    return this.load(authUser, branchId, query, false);
  }

  async executeCsv(
    authUser: JwtPayload,
    branchId: string,
    query: OpenTabsQuery,
  ): Promise<CsvDownload> {
    const response = await this.load(authUser, branchId, query, true);
    const { rows } = response;

    return rowsCsv(
      `cuentas-${response.kind}_${branchId}.csv`,
      OPEN_TABS_CSV_HEADERS,
      rows.map((row) => [
        row.orderNumber,
        row.table,
        row.zone,
        row.waiter,
        row.customerLabel,
        row.guests,
        row.billStatus ?? row.sessionStatus,
        formatZonedDateTime(new Date(row.openedAt), response.timeZone),
        row.endedAt
          ? formatZonedDateTime(new Date(row.endedAt), response.timeZone)
          : null,
        row.ageMinutes,
        Number(row.total),
        Number(row.paid),
        Number(row.pending),
        row.alert ? 'SI' : 'NO',
        row.closeReason,
        row.cancelledOrders,
        row.cancelledAmount === null ? null : Number(row.cancelledAmount),
      ]),
    );
  }

  private async load(
    authUser: JwtPayload,
    branchId: string,
    query: OpenTabsQuery,
    forCsv: boolean,
  ): Promise<OpenTabsResponse> {
    const kind = query.kind ?? 'open';
    const now = new Date();
    let timeZone: string;
    let from: string | null = null;
    let to: string | null = null;
    let start = now;
    let end = now;
    let filters = parseReportFilters(query);

    if (kind === 'open') {
      const access = await this.scopeService.resolveAccess(authUser, branchId);

      if (access.cashierScoped) {
        throw new ForbiddenException(
          'Solo ADMIN y SUPERVISOR pueden ver las cuentas abiertas.',
        );
      }

      timeZone = access.timeZone;
    } else {
      const scope = await this.scopeService.resolve(authUser, branchId, query, {
        forCsv,
        fullAccessOnly: true,
      });

      timeZone = scope.timeZone;
      from = scope.from;
      to = scope.to;
      start = scope.start;
      end = scope.end;
      filters = scope.filters;
    }

    const filter: OpenTabsFilter = {
      kind,
      branchId,
      start,
      end,
      waiterId: filters.waiterId,
      tableId: filters.tableId,
      zoneId: filters.zoneId,
      limit: MAX_OPEN_TAB_ROWS + 1,
    };
    const records = await this.insightsRepository.findOpenTabs(filter);
    const truncated = records.length > MAX_OPEN_TAB_ROWS;
    const rows = records
      .slice(0, MAX_OPEN_TAB_ROWS)
      .map((record) => buildOpenTabRow(record, kind, now));

    return {
      kind,
      from,
      to,
      timeZone,
      alertAfterMinutes: OPEN_TAB_ALERT_MINUTES,
      rows,
      truncated,
      totals: {
        count: rows.length,
        pending: money(
          rows.reduce(
            (total, row) => total.add(new Prisma.Decimal(row.pending)),
            ZERO,
          ),
        ),
        alerts: rows.filter((row) => row.alert).length,
      },
    };
  }
}

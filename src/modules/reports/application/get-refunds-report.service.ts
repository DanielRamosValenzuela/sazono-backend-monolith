import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { formatZonedDateTime } from '../../../common/time/restaurant-time';
import type { JwtPayload } from '../../auth/interfaces/jwt-payload.interface';
import {
  ReportsPrismaRepository,
  type RefundReportRecord,
  type RefundTotalRecord,
  type RefundsPageFilter,
} from '../infrastructure/reports.prisma.repository';
import type { CsvDownload } from './get-sales-by-order.service';
import { csvStream, type CsvCell } from './report-csv';
import {
  decodeCursor,
  encodeCursor,
  type CursorValueKind,
} from './report-cursor';
import {
  ReportScopeService,
  type ReportScopeQuery,
} from './report-scope.service';
import {
  CSV_BATCH_SIZE,
  DEFAULT_PAGE_LIMIT,
  MAX_PAGE_LIMIT,
  METHOD_LABELS,
  REFUND_METHODS,
  REFUND_REASON_CODES,
  REFUND_STATUSES,
  UNCLASSIFIED_METHOD,
  type KeysetCursor,
  type MethodKey,
  type RefundMethodKey,
  type RefundReasonCode,
  type RefundStatusKey,
  type RefundsOrderBy,
  type ReportScope,
  type SortDirection,
} from './report-types';

export type RefundsReportQuery = ReportScopeQuery & {
  requestedById?: string;
  reasonCode?: string;
  refundStatus?: string;
  refundMethod?: string;
  orderBy?: RefundsOrderBy;
  direction?: SortDirection;
  cursor?: string;
  limit?: number;
};

export type RefundsReportRow = {
  refundId: string;
  completedAt: string | null;
  billId: string;
  orderNumber: string;
  table: string | null;
  paymentId: string;
  paymentMethod: MethodKey;
  provider: string;
  amount: string;
  consumption: string;
  tip: string;
  net: string;
  vat: string;
  refundMethod: string;
  status: string;
  reasonCode: string;
  reasonText: string;
  requestedById: string | null;
  requestedBy: string | null;
  requestedByRole: string | null;
  approvedBy: string | null;
  cashier: string | null;
  creditNoteStatus: string;
  creditNoteFolio: string | null;
  billHasActiveOrders: boolean;
};

export type RefundsReportTotals = {
  count: number;
  amount: string;
  consumption: string;
  tip: string;
  net: string;
  vat: string;
  byMethod: { method: MethodKey; count: number; amount: string }[];
  byReason: { reasonCode: string; count: number; amount: string }[];
  byRequester: {
    staffUserId: string | null;
    name: string | null;
    count: number;
    amount: string;
  }[];
};

export type RefundsReportResponse = {
  from: string;
  to: string;
  timeZone: string;
  cashierId: string | null;
  orderBy: RefundsOrderBy;
  direction: SortDirection;
  rows: RefundsReportRow[];
  totals: RefundsReportTotals;
  nextCursor: string | null;
  limit: number;
};

const CURSOR_KINDS: Record<RefundsOrderBy, CursorValueKind> = {
  completedAt: 'timestamp',
  amount: 'number',
};

export const REFUND_REASON_LABELS: Record<RefundReasonCode, string> = {
  CUSTOMER_COMPLAINT: 'Reclamo del cliente',
  WRONG_ORDER: 'Pedido equivocado',
  DISH_UNAVAILABLE: 'Plato no disponible',
  QUALITY_ISSUE: 'Problema de calidad',
  DUPLICATE_CHARGE: 'Cobro duplicado',
  CASHIER_ERROR: 'Error de caja',
  OTHER: 'Otro',
};

const REFUND_METHOD_LABELS: Record<RefundMethodKey, string> = {
  CASH_MANUAL: 'Efectivo manual',
  GATEWAY: 'Pasarela',
  MANUAL_EXTERNAL: 'Manual externo',
};

const ZERO = new Prisma.Decimal(0);
const money = (value: Prisma.Decimal.Value): string =>
  new Prisma.Decimal(value).toFixed(0);

function parseList<T extends string>(
  raw: string | undefined,
  allowed: readonly T[],
  label: string,
): T[] {
  if (!raw) {
    return [];
  }

  const requested = raw.split(',').map((value) => value.trim());
  const invalid = requested.filter((value) => !allowed.includes(value as T));

  if (invalid.length > 0) {
    throw new BadRequestException(`${label} no valido: ${invalid.join(', ')}.`);
  }

  return [...new Set(requested as T[])];
}

function sortValueOf(
  record: RefundReportRecord,
  orderBy: RefundsOrderBy,
): string {
  return orderBy === 'amount'
    ? new Prisma.Decimal(record.amount).toFixed(2)
    : record.completed_at.toISOString();
}

export function buildRefundsReportRow(
  record: RefundReportRecord,
): RefundsReportRow {
  const amount = new Prisma.Decimal(record.amount);
  const tip = new Prisma.Decimal(record.tip_amount);

  return {
    refundId: record.id,
    completedAt: record.completed_at?.toISOString() ?? null,
    billId: record.bill_id,
    orderNumber: record.order_number,
    table: record.table_name,
    paymentId: record.payment_id,
    paymentMethod: (record.payment_method ?? UNCLASSIFIED_METHOD) as MethodKey,
    provider: record.provider,
    amount: money(amount),
    consumption: money(amount.sub(tip)),
    tip: money(tip),
    net: money(record.net_amount),
    vat: money(record.vat_amount),
    refundMethod: record.refund_method,
    status: record.status,
    reasonCode: record.reason_code,
    reasonText: record.reason_text,
    requestedById: record.requested_by_staff_user_id,
    requestedBy: record.requested_by_name,
    requestedByRole: record.requested_by_role,
    approvedBy: record.approved_by_name,
    cashier: record.cashier_name,
    creditNoteStatus: record.credit_note_status,
    creditNoteFolio: record.credit_note_folio,
    billHasActiveOrders: record.bill_has_active_orders,
  };
}

type Bucket = { count: number; amount: Prisma.Decimal };

function addTo(
  map: Map<string, Bucket & { name?: string | null }>,
  key: string,
  record: RefundTotalRecord,
  name?: string | null,
): void {
  const current = map.get(key) ?? { count: 0, amount: ZERO, name };

  map.set(key, {
    count: current.count + record.count,
    amount: current.amount.add(record.amount),
    name: current.name ?? name,
  });
}

export function buildRefundsReportTotals(
  records: RefundTotalRecord[],
): RefundsReportTotals {
  const byMethod = new Map<string, Bucket>();
  const byReason = new Map<string, Bucket>();
  const byRequester = new Map<string, Bucket & { name?: string | null }>();
  let count = 0;
  let amount = ZERO;
  let consumption = ZERO;
  let tip = ZERO;
  let net = ZERO;
  let vat = ZERO;

  for (const record of records) {
    count += record.count;
    net = net.add(record.net);
    vat = vat.add(record.vat);
    amount = amount.add(record.amount);
    consumption = consumption.add(record.consumption);
    tip = tip.add(record.tip);
    addTo(byMethod, record.method ?? UNCLASSIFIED_METHOD, record);
    addTo(byReason, record.reason_code, record);
    addTo(
      byRequester,
      record.requested_by_staff_user_id ?? '',
      record,
      record.requested_by_name,
    );
  }

  return {
    count,
    amount: money(amount),
    consumption: money(consumption),
    tip: money(tip),
    net: money(net),
    vat: money(vat),
    byMethod: [...byMethod.entries()].map(([method, value]) => ({
      method: method as MethodKey,
      count: value.count,
      amount: money(value.amount),
    })),
    byReason: [...byReason.entries()].map(([reasonCode, value]) => ({
      reasonCode,
      count: value.count,
      amount: money(value.amount),
    })),
    byRequester: [...byRequester.entries()].map(([staffUserId, value]) => ({
      staffUserId: staffUserId === '' ? null : staffUserId,
      name: value.name ?? null,
      count: value.count,
      amount: money(value.amount),
    })),
  };
}

export const REFUNDS_CSV_HEADERS = [
  'Fecha',
  'Comanda',
  'Mesa',
  'Medio de pago',
  'Proveedor',
  'Monto',
  'Consumo',
  'Propina',
  'Neto',
  'IVA',
  'Motivo',
  'Detalle',
  'Registrado por',
  'Rol',
  'Aprobado por',
  'Cajero',
  'Metodo de reembolso',
  'Estado',
  'Nota de credito',
  'Folio nota de credito',
];

function refundRowToCsv(row: RefundsReportRow, timeZone: string): CsvCell[] {
  return [
    row.completedAt
      ? formatZonedDateTime(new Date(row.completedAt), timeZone)
      : null,
    row.orderNumber,
    row.table,
    METHOD_LABELS[row.paymentMethod],
    row.provider,
    Number(row.amount),
    Number(row.consumption),
    Number(row.tip),
    Number(row.net),
    Number(row.vat),
    REFUND_REASON_LABELS[row.reasonCode as RefundReasonCode] ?? row.reasonCode,
    row.reasonText,
    row.requestedBy,
    row.requestedByRole,
    row.approvedBy,
    row.cashier,
    REFUND_METHOD_LABELS[row.refundMethod as RefundMethodKey] ??
      row.refundMethod,
    row.status,
    row.creditNoteStatus,
    row.creditNoteFolio,
  ];
}

function refundTotalsToCsv(totals: RefundsReportTotals): CsvCell[] {
  return [
    'TOTAL',
    totals.count,
    '',
    '',
    '',
    Number(totals.amount),
    Number(totals.consumption),
    Number(totals.tip),
    Number(totals.net),
    Number(totals.vat),
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
  ];
}

@Injectable()
export class GetRefundsReportService {
  constructor(
    private readonly scopeService: ReportScopeService,
    private readonly reportsRepository: ReportsPrismaRepository,
  ) {}

  async execute(
    authUser: JwtPayload,
    branchId: string,
    query: RefundsReportQuery,
  ): Promise<RefundsReportResponse> {
    const scope = await this.scopeService.resolve(authUser, branchId, query, {
      forCsv: false,
    });
    const filter = this.toFilter(scope, query);
    const limit = Math.min(query.limit ?? DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT);

    const [page, totalRecords] = await Promise.all([
      this.loadPage(
        filter,
        decodeCursor(query.cursor, CURSOR_KINDS[filter.orderBy]),
        limit,
      ),
      this.reportsRepository.findRefundTotals(filter),
    ]);

    return {
      from: scope.from,
      to: scope.to,
      timeZone: scope.timeZone,
      cashierId: scope.cashierId,
      orderBy: filter.orderBy,
      direction: filter.direction,
      rows: page.rows,
      totals: buildRefundsReportTotals(totalRecords),
      nextCursor: page.nextCursor,
      limit,
    };
  }

  async executeCsv(
    authUser: JwtPayload,
    branchId: string,
    query: RefundsReportQuery,
  ): Promise<CsvDownload> {
    const scope = await this.scopeService.resolve(authUser, branchId, query, {
      forCsv: true,
    });
    const filter = this.toFilter(scope, query);
    const totalRecords = await this.reportsRepository.findRefundTotals(filter);

    return {
      filename: `reembolsos_${branchId}_${scope.from}_${scope.to}.csv`,
      stream: csvStream(
        REFUNDS_CSV_HEADERS,
        this.csvLines(
          filter,
          scope.timeZone,
          buildRefundsReportTotals(totalRecords),
        ),
      ),
    };
  }

  private async *csvLines(
    filter: RefundsPageFilter,
    timeZone: string,
    totals: RefundsReportTotals,
  ): AsyncGenerator<CsvCell[]> {
    let cursor: KeysetCursor | null = null;

    do {
      const page = await this.loadPage(filter, cursor, CSV_BATCH_SIZE);

      for (const row of page.rows) {
        yield refundRowToCsv(row, timeZone);
      }

      cursor = decodeCursor(
        page.nextCursor ?? undefined,
        CURSOR_KINDS[filter.orderBy],
      );
    } while (cursor !== null);

    yield refundTotalsToCsv(totals);
  }

  private toFilter(
    scope: ReportScope,
    query: RefundsReportQuery,
  ): RefundsPageFilter {
    const requestedById = query.requestedById ?? null;

    return {
      branchId: scope.branchId,
      start: scope.start,
      end: scope.end,
      timeZone: scope.timeZone,
      scopedToStaffUserId: scope.cashierScoped ? scope.cashierId : null,
      cashierId: scope.cashierScoped ? null : scope.cashierId,
      requestedById: scope.cashierScoped ? null : requestedById,
      methods: scope.methods,
      sources: scope.filters.sources,
      reasonCodes: parseList(
        query.reasonCode,
        REFUND_REASON_CODES,
        'Motivo de reembolso',
      ),
      refundStatuses: parseList(
        query.refundStatus,
        REFUND_STATUSES as readonly RefundStatusKey[],
        'Estado de reembolso',
      ),
      refundMethods: parseList(
        query.refundMethod,
        REFUND_METHODS,
        'Metodo de reembolso',
      ),
      waiterId: scope.filters.waiterId,
      tableId: scope.filters.tableId,
      zoneId: scope.filters.zoneId,
      minAmount: scope.filters.minAmount,
      maxAmount: scope.filters.maxAmount,
      hasTip: scope.filters.hasTip,
      minTip: scope.filters.minTip,
      timeFromMinute: scope.filters.timeFromMinute,
      timeToMinute: scope.filters.timeToMinute,
      weekdays: scope.filters.weekdays,
      q: scope.filters.q,
      orderBy: query.orderBy ?? 'completedAt',
      direction: query.direction ?? 'desc',
    };
  }

  private async loadPage(
    filter: RefundsPageFilter,
    cursor: KeysetCursor | null,
    limit: number,
  ): Promise<{ rows: RefundsReportRow[]; nextCursor: string | null }> {
    const fetched = await this.reportsRepository.findRefundsPage(
      filter,
      cursor,
      limit + 1,
    );
    const hasMore = fetched.length > limit;
    const records = hasMore ? fetched.slice(0, limit) : fetched;
    const last = records[records.length - 1];

    return {
      rows: records.map(buildRefundsReportRow),
      nextCursor:
        hasMore && last
          ? encodeCursor({
              value: sortValueOf(last, filter.orderBy),
              id: last.id,
            })
          : null,
    };
  }
}

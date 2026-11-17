import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { formatZonedDateTime } from '../../../common/time/restaurant-time';
import type { JwtPayload } from '../../auth/interfaces/jwt-payload.interface';
import {
  ReportsPrismaRepository,
  type PaymentReportRecord,
  type PaymentStatusTotalRecord,
  type PaymentsReportFilter,
} from '../infrastructure/reports.prisma.repository';
import type { CsvDownload } from './get-sales-by-order.service';
import { csvStream, type CsvCell } from './report-csv';
import { decodeCursor, encodeCursor } from './report-cursor';
import {
  ReportScopeService,
  type ReportScopeQuery,
} from './report-scope.service';
import {
  CAJA_ONLINE_LABEL,
  CAJA_UNASSIGNED_LABEL,
  CSV_BATCH_SIZE,
  DEFAULT_PAGE_LIMIT,
  MAX_PAGE_LIMIT,
  METHOD_LABELS,
  UNCLASSIFIED_METHOD,
  type KeysetCursor,
  type MethodKey,
  type ReportScope,
} from './report-types';

export type PaymentsReportQuery = ReportScopeQuery & {
  kind?: 'payment' | 'attempt' | 'all';
  provider?: string;
  paymentStatus?: string;
  cursor?: string;
  limit?: number;
};

export type PaymentsReportRow = {
  id: string;
  kind: 'PAYMENT' | 'ATTEMPT';
  createdAt: string;
  paidAt: string | null;
  billId: string | null;
  orderNumber: string | null;
  table: string | null;
  method: MethodKey | null;
  provider: string;
  providerReference: string | null;
  status: string;
  providerStatus: string | null;
  providerStatusDetail: string | null;
  failureReason: string | null;
  amount: string;
  tip: string;
  total: string;
  cashier: string | null;
  caja: string;
  source: string | null;
  refunded: string;
};

export type PaymentsReportStatusTotal = {
  status: string;
  count: number;
  amount: string;
  tip: string;
};

export type PaymentsReportMethodTotal = {
  method: MethodKey;
  count: number;
  amount: string;
  tip: string;
};

export type PaymentsReportResponse = {
  from: string;
  to: string;
  timeZone: string;
  cashierId: string | null;
  rows: PaymentsReportRow[];
  totals: {
    byStatus: PaymentsReportStatusTotal[];
    byMethod: PaymentsReportMethodTotal[];
  };
  nextCursor: string | null;
  limit: number;
};

const ZERO = new Prisma.Decimal(0);
const money = (value: Prisma.Decimal.Value): string =>
  new Prisma.Decimal(value).toFixed(0);

function describeCaja(record: PaymentReportRecord): string {
  if (record.staff_name) {
    return record.staff_name;
  }

  return record.source === 'WEB_QR' || record.kind === 'ATTEMPT'
    ? CAJA_ONLINE_LABEL
    : CAJA_UNASSIGNED_LABEL;
}

export function buildPaymentsReportRow(
  record: PaymentReportRecord,
): PaymentsReportRow {
  const amount = new Prisma.Decimal(record.amount);
  const tip = new Prisma.Decimal(record.tip);

  return {
    id: record.id,
    kind: record.kind,
    createdAt: record.created_at.toISOString(),
    paidAt: record.paid_at?.toISOString() ?? null,
    billId: record.bill_id,
    orderNumber: record.order_number,
    table: record.table_name,
    method: record.method as MethodKey | null,
    provider: record.provider,
    providerReference: record.provider_reference,
    status: record.status,
    providerStatus: record.provider_status,
    providerStatusDetail: record.provider_status_detail,
    failureReason: record.failure_reason,
    amount: money(amount),
    tip: money(tip),
    total: money(amount.add(tip)),
    cashier: record.staff_name,
    caja: describeCaja(record),
    source: record.source,
    refunded: '0',
  };
}

export function buildPaymentsReportTotals(
  records: PaymentStatusTotalRecord[],
): PaymentsReportResponse['totals'] {
  const byStatus = new Map<
    string,
    { count: number; amount: Prisma.Decimal; tip: Prisma.Decimal }
  >();
  const byMethod = new Map<
    string,
    { count: number; amount: Prisma.Decimal; tip: Prisma.Decimal }
  >();

  for (const record of records) {
    const status = byStatus.get(record.status) ?? {
      count: 0,
      amount: ZERO,
      tip: ZERO,
    };

    byStatus.set(record.status, {
      count: status.count + record.count,
      amount: status.amount.add(record.consumption),
      tip: status.tip.add(record.tip),
    });

    if (record.kind === 'PAYMENT' && record.status === 'PAID') {
      const key = record.method ?? UNCLASSIFIED_METHOD;
      const method = byMethod.get(key) ?? {
        count: 0,
        amount: ZERO,
        tip: ZERO,
      };

      byMethod.set(key, {
        count: method.count + record.count,
        amount: method.amount.add(record.consumption),
        tip: method.tip.add(record.tip),
      });
    }
  }

  return {
    byStatus: [...byStatus.entries()].map(([status, value]) => ({
      status,
      count: value.count,
      amount: money(value.amount),
      tip: money(value.tip),
    })),
    byMethod: [...byMethod.entries()].map(([method, value]) => ({
      method: method as MethodKey,
      count: value.count,
      amount: money(value.amount),
      tip: money(value.tip),
    })),
  };
}

export const PAYMENTS_CSV_HEADERS = [
  'Fecha',
  'Fecha pago',
  'Tipo',
  'Comanda',
  'Mesa',
  'Medio de pago',
  'Proveedor',
  'Referencia',
  'Estado',
  'Estado proveedor',
  'Detalle proveedor',
  'Motivo de falla',
  'Monto',
  'Propina',
  'Total cobrado',
  'Caja',
  'Cajero',
  'Origen',
  'Reembolsado',
];

function paymentRowToCsv(row: PaymentsReportRow, timeZone: string): CsvCell[] {
  return [
    formatZonedDateTime(new Date(row.createdAt), timeZone),
    row.paidAt ? formatZonedDateTime(new Date(row.paidAt), timeZone) : null,
    row.kind === 'PAYMENT' ? 'Pago' : 'Intento',
    row.orderNumber,
    row.table,
    row.kind === 'PAYMENT'
      ? METHOD_LABELS[row.method ?? UNCLASSIFIED_METHOD]
      : null,
    row.provider,
    row.providerReference,
    row.status,
    row.providerStatus,
    row.providerStatusDetail,
    row.failureReason,
    Number(row.amount),
    Number(row.tip),
    Number(row.total),
    row.caja,
    row.cashier,
    row.source,
    Number(row.refunded),
  ];
}

@Injectable()
export class GetPaymentsReportService {
  constructor(
    private readonly scopeService: ReportScopeService,
    private readonly reportsRepository: ReportsPrismaRepository,
  ) {}

  async execute(
    authUser: JwtPayload,
    branchId: string,
    query: PaymentsReportQuery,
  ): Promise<PaymentsReportResponse> {
    const scope = await this.scopeService.resolve(authUser, branchId, query, {
      forCsv: false,
    });
    const filter = this.toFilter(scope, query);
    const limit = Math.min(query.limit ?? DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT);

    const [page, totalRecords] = await Promise.all([
      this.loadPage(filter, decodeCursor(query.cursor), limit),
      this.reportsRepository.findPaymentStatusTotals(filter),
    ]);

    return {
      from: scope.from,
      to: scope.to,
      timeZone: scope.timeZone,
      cashierId: scope.cashierId,
      rows: page.rows,
      totals: buildPaymentsReportTotals(totalRecords),
      nextCursor: page.nextCursor,
      limit,
    };
  }

  async executeCsv(
    authUser: JwtPayload,
    branchId: string,
    query: PaymentsReportQuery,
  ): Promise<CsvDownload> {
    const scope = await this.scopeService.resolve(authUser, branchId, query, {
      forCsv: true,
    });
    const filter = this.toFilter(scope, query);

    return {
      filename: `pagos_${branchId}_${scope.from}_${scope.to}.csv`,
      stream: csvStream(
        PAYMENTS_CSV_HEADERS,
        this.csvLines(filter, scope.timeZone),
      ),
    };
  }

  private async *csvLines(
    filter: PaymentsReportFilter,
    timeZone: string,
  ): AsyncGenerator<CsvCell[]> {
    let cursor: KeysetCursor | null = null;

    do {
      const page = await this.loadPage(filter, cursor, CSV_BATCH_SIZE);

      for (const row of page.rows) {
        yield paymentRowToCsv(row, timeZone);
      }

      cursor = decodeCursor(page.nextCursor ?? undefined);
    } while (cursor !== null);
  }

  private toFilter(
    scope: ReportScope,
    query: PaymentsReportQuery,
  ): PaymentsReportFilter {
    return {
      branchId: scope.branchId,
      start: scope.start,
      end: scope.end,
      cashierId: scope.cashierId,
      methods: scope.methods,
      kind: query.kind ?? 'all',
      provider: query.provider ?? null,
      status: query.paymentStatus ?? null,
    };
  }

  private async loadPage(
    filter: PaymentsReportFilter,
    cursor: KeysetCursor | null,
    limit: number,
  ): Promise<{ rows: PaymentsReportRow[]; nextCursor: string | null }> {
    const fetched = await this.reportsRepository.findPaymentsPage(
      filter,
      cursor,
      limit + 1,
    );
    const hasMore = fetched.length > limit;
    const records = hasMore ? fetched.slice(0, limit) : fetched;
    const last = records[records.length - 1];

    return {
      rows: records.map(buildPaymentsReportRow),
      nextCursor:
        hasMore && last
          ? encodeCursor({ at: last.event_at, id: last.id })
          : null,
    };
  }
}

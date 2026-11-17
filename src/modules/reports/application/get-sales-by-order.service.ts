import type { Readable } from 'node:stream';
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { formatZonedDateTime } from '../../../common/time/restaurant-time';
import type { JwtPayload } from '../../auth/interfaces/jwt-payload.interface';
import {
  ReportsPrismaRepository,
  type BillPageFilter,
  type BillPageRecord,
  type BillPaymentRecord,
  type BillRowRecord,
  type MethodTotalRecord,
} from '../infrastructure/reports.prisma.repository';
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
  CAJA_ONLINE_LABEL,
  CAJA_UNASSIGNED_LABEL,
  CSV_BATCH_SIZE,
  DEFAULT_PAGE_LIMIT,
  MAX_PAGE_LIMIT,
  METHOD_KEYS,
  METHOD_LABELS,
  UNCLASSIFIED_METHOD,
  type KeysetCursor,
  type MethodAmount,
  type MethodKey,
  type ReportScope,
  type SalesOrderBy,
  type SortDirection,
} from './report-types';

export type SalesByOrderQuery = ReportScopeQuery & {
  minTotal?: number;
  maxTotal?: number;
  orderBy?: SalesOrderBy;
  direction?: SortDirection;
  cursor?: string;
  limit?: number;
};

const CURSOR_KINDS: Record<SalesOrderBy, CursorValueKind> = {
  closedAt: 'timestamp',
  total: 'number',
  tip: 'number',
  orderNumber: 'text',
};

export type SalesByOrderRow = {
  billId: string;
  closedAt: string;
  orderNumber: string;
  caja: string;
  table: string | null;
  zone: string | null;
  waiter: string | null;
  cashier: string | null;
  guests: number | null;
  paymentStatus: 'Pagado' | 'Mixto';
  total: string;
  discounts: string;
  payable: string;
  tip: string;
  paymentsCount: number;
  receipt: string | null;
  receiptNumber: string | null;
  refunded: string;
  methods: MethodAmount[];
};

export type SalesByOrderTotals = {
  bills: number;
  paymentsCount: number;
  total: string;
  discounts: string;
  payable: string;
  tip: string;
  refunded: string;
  methods: MethodAmount[];
};

export type SalesByOrderResponse = {
  from: string;
  to: string;
  timeZone: string;
  cashierId: string | null;
  orderBy: SalesOrderBy;
  direction: SortDirection;
  rows: SalesByOrderRow[];
  totals: SalesByOrderTotals;
  nextCursor: string | null;
  limit: number;
};

export function sortValueOf(
  bill: BillPageRecord,
  orderBy: SalesOrderBy,
): string {
  switch (orderBy) {
    case 'total':
      return new Prisma.Decimal(bill.bill_total).toFixed(2);
    case 'tip':
      return new Prisma.Decimal(bill.bill_tip).toFixed(2);
    case 'orderNumber':
      return bill.order_key;
    default:
      return bill.closed_at.toISOString();
  }
}

export type CsvDownload = { filename: string; stream: Readable };

const ZERO = new Prisma.Decimal(0);
const money = (value: Prisma.Decimal.Value): string =>
  new Prisma.Decimal(value).toFixed(0);

function emptyMethodSums(): Record<MethodKey, Prisma.Decimal> {
  return Object.fromEntries(
    METHOD_KEYS.map((method) => [method, ZERO]),
  ) as Record<MethodKey, Prisma.Decimal>;
}

function toMethodAmounts(
  sums: Record<MethodKey, Prisma.Decimal>,
): MethodAmount[] {
  return METHOD_KEYS.map((method) => ({
    method,
    amount: money(sums[method]),
  }));
}

function methodKeyOf(method: string | null): MethodKey {
  return (method ?? UNCLASSIFIED_METHOD) as MethodKey;
}

function describeCaja(payments: BillPaymentRecord[]): string {
  const labels = new Set<string>();

  for (const payment of payments) {
    if (payment.staff_name) {
      labels.add(payment.staff_name);
    } else if (payment.source === 'WEB_QR') {
      labels.add(CAJA_ONLINE_LABEL);
    } else {
      labels.add(CAJA_UNASSIGNED_LABEL);
    }
  }

  return labels.size > 0 ? [...labels].join(', ') : CAJA_UNASSIGNED_LABEL;
}

export function buildSalesByOrderRow(
  bill: BillRowRecord,
  payments: BillPaymentRecord[],
): SalesByOrderRow {
  const sums = emptyMethodSums();
  let total = ZERO;
  let tip = ZERO;

  for (const payment of payments) {
    const paymentTip = new Prisma.Decimal(payment.tip_amount);
    const consumption = new Prisma.Decimal(payment.amount).sub(paymentTip);
    const key = methodKeyOf(payment.method);

    sums[key] = sums[key].add(consumption);
    total = total.add(consumption);
    tip = tip.add(paymentTip);
  }

  const cashiers = [
    ...new Set(
      payments
        .map((payment) => payment.staff_name)
        .filter((name): name is string => name !== null),
    ),
  ];
  const distinctMethods = new Set(
    payments.map((payment) => methodKeyOf(payment.method)),
  );

  return {
    billId: bill.id,
    closedAt: bill.closed_at.toISOString(),
    orderNumber:
      bill.ticket_number?.toString() ?? bill.id.slice(-6).toUpperCase(),
    caja: describeCaja(payments),
    table: bill.table_name,
    zone: bill.zone_name,
    waiter: bill.waiter_name,
    cashier: cashiers.length > 0 ? cashiers.join(', ') : null,
    guests: bill.guest_count,
    paymentStatus: distinctMethods.size > 1 ? 'Mixto' : 'Pagado',
    total: money(total),
    discounts: '0',
    payable: money(total),
    tip: money(tip),
    paymentsCount: payments.length,
    receipt: null,
    receiptNumber: null,
    refunded: '0',
    methods: toMethodAmounts(sums),
  };
}

export function buildSalesByOrderTotals(
  billCount: number,
  methodTotals: MethodTotalRecord[],
): SalesByOrderTotals {
  const sums = emptyMethodSums();
  let total = ZERO;
  let tip = ZERO;
  let paymentsCount = 0;

  for (const record of methodTotals) {
    const key = methodKeyOf(record.method);
    const consumption = new Prisma.Decimal(record.consumption);

    sums[key] = sums[key].add(consumption);
    total = total.add(consumption);
    tip = tip.add(record.tip);
    paymentsCount += record.payments;
  }

  return {
    bills: billCount,
    paymentsCount,
    total: money(total),
    discounts: '0',
    payable: money(total),
    tip: money(tip),
    refunded: '0',
    methods: toMethodAmounts(sums),
  };
}

export const SALES_BY_ORDER_CSV_HEADERS = [
  'Fecha cierre',
  'Comanda',
  'Caja',
  'Mesa',
  'Zona',
  'Mesero',
  'Cajero',
  'Comensales',
  'Pago',
  'Total',
  'Descuentos',
  'A pagar',
  'Propina',
  'N° pagos',
  'Boleta',
  'N° boleta',
  'Reembolsado',
  ...METHOD_KEYS.map((method) => METHOD_LABELS[method]),
];

function salesRowToCsv(row: SalesByOrderRow, timeZone: string): CsvCell[] {
  return [
    formatZonedDateTime(new Date(row.closedAt), timeZone),
    row.orderNumber,
    row.caja,
    row.table,
    row.zone,
    row.waiter,
    row.cashier,
    row.guests,
    row.paymentStatus,
    Number(row.total),
    Number(row.discounts),
    Number(row.payable),
    Number(row.tip),
    row.paymentsCount,
    row.receipt,
    row.receiptNumber,
    Number(row.refunded),
    ...row.methods.map((entry) => Number(entry.amount)),
  ];
}

function salesTotalsToCsv(totals: SalesByOrderTotals): CsvCell[] {
  return [
    'TOTAL',
    totals.bills,
    '',
    '',
    '',
    '',
    '',
    null,
    '',
    Number(totals.total),
    Number(totals.discounts),
    Number(totals.payable),
    Number(totals.tip),
    totals.paymentsCount,
    '',
    '',
    Number(totals.refunded),
    ...totals.methods.map((entry) => Number(entry.amount)),
  ];
}

@Injectable()
export class GetSalesByOrderService {
  constructor(
    private readonly scopeService: ReportScopeService,
    private readonly reportsRepository: ReportsPrismaRepository,
  ) {}

  async execute(
    authUser: JwtPayload,
    branchId: string,
    query: SalesByOrderQuery,
  ): Promise<SalesByOrderResponse> {
    const scope = await this.resolveScope(authUser, branchId, query, false);
    const filter = this.toFilter(scope, query);
    const limit = Math.min(query.limit ?? DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT);

    const [page, methodTotals] = await Promise.all([
      this.loadPage(
        filter,
        decodeCursor(query.cursor, CURSOR_KINDS[filter.orderBy]),
        limit,
      ),
      this.reportsRepository.findMethodTotals(filter),
    ]);

    return {
      from: scope.from,
      to: scope.to,
      timeZone: scope.timeZone,
      cashierId: scope.cashierId,
      orderBy: filter.orderBy,
      direction: filter.direction,
      rows: page.rows,
      totals: buildSalesByOrderTotals(
        methodTotals[0]?.bills ?? 0,
        methodTotals,
      ),
      nextCursor: page.nextCursor,
      limit,
    };
  }

  async executeCsv(
    authUser: JwtPayload,
    branchId: string,
    query: SalesByOrderQuery,
  ): Promise<CsvDownload> {
    const scope = await this.resolveScope(authUser, branchId, query, true);
    const filter = this.toFilter(scope, query);
    const methodTotals = await this.reportsRepository.findMethodTotals(filter);
    const totals = buildSalesByOrderTotals(
      methodTotals[0]?.bills ?? 0,
      methodTotals,
    );

    return {
      filename: `cierre-ventas_${branchId}_${scope.from}_${scope.to}.csv`,
      stream: csvStream(
        SALES_BY_ORDER_CSV_HEADERS,
        this.csvLines(filter, scope.timeZone, totals),
      ),
    };
  }

  private resolveScope(
    authUser: JwtPayload,
    branchId: string,
    query: SalesByOrderQuery,
    forCsv: boolean,
  ): Promise<ReportScope> {
    return this.scopeService.resolve(
      authUser,
      branchId,
      {
        ...query,
        minAmount: query.minTotal,
        maxAmount: query.maxTotal,
      },
      { forCsv },
    );
  }

  private async *csvLines(
    filter: BillPageFilter,
    timeZone: string,
    totals: SalesByOrderTotals,
  ): AsyncGenerator<CsvCell[]> {
    let cursor: KeysetCursor | null = null;

    do {
      const page = await this.loadPage(filter, cursor, CSV_BATCH_SIZE);

      for (const row of page.rows) {
        yield salesRowToCsv(row, timeZone);
      }

      cursor = decodeCursor(
        page.nextCursor ?? undefined,
        CURSOR_KINDS[filter.orderBy],
      );
    } while (cursor !== null);

    yield salesTotalsToCsv(totals);
  }

  private toFilter(
    scope: ReportScope,
    query: SalesByOrderQuery,
  ): BillPageFilter {
    return {
      ...scope.filters,
      branchId: scope.branchId,
      start: scope.start,
      end: scope.end,
      timeZone: scope.timeZone,
      cashierId: scope.cashierId,
      methods: scope.methods,
      orderBy: query.orderBy ?? 'closedAt',
      direction: query.direction ?? 'desc',
    };
  }

  private async loadPage(
    filter: BillPageFilter,
    cursor: KeysetCursor | null,
    limit: number,
  ): Promise<{ rows: SalesByOrderRow[]; nextCursor: string | null }> {
    const fetched = await this.reportsRepository.findBillPage(
      filter,
      cursor,
      limit + 1,
    );
    const hasMore = fetched.length > limit;
    const bills = hasMore ? fetched.slice(0, limit) : fetched;
    const last = bills[bills.length - 1];

    return {
      rows: bills.map((bill) => buildSalesByOrderRow(bill, bill.payments)),
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

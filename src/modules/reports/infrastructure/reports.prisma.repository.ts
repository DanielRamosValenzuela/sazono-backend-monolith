import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import {
  SOLD_ORDER_STATUSES,
  UNCLASSIFIED_METHOD,
  type KeysetCursor,
  type PaymentsOrderBy,
  type RefundsOrderBy,
  type SortDirection,
} from '../application/report-types';
import {
  directionSql,
  discountOnlyBillsSql,
  eligibleBillsSql,
  paidPaymentConditionSql,
  paymentsFilteredSql,
  refundJoinSql,
  periodRefundsSql,
  refundsByMethodSql,
  refundsFilteredSql,
  type BillFilter,
  type BillPageFilter,
  type PaymentsReportFilter,
  type RefundsByMethodFilter,
  type RefundsReportFilter,
} from './report-sql';

export type {
  BillFilter,
  BillPageFilter,
  PaymentsReportFilter,
  RefundsByMethodFilter,
  RefundsReportFilter,
};

export type RefundsPageFilter = RefundsReportFilter & {
  orderBy: RefundsOrderBy;
  direction: SortDirection;
};

export type RefundItemReportRecord = {
  bill_item_id: string;
  name: string;
  quantity: number;
  amount: Prisma.Decimal.Value;
  kitchen_waste: boolean;
};

export type RefundReportRecord = {
  items?: RefundItemReportRecord[];
  id: string;
  completed_at: Date;
  amount: Prisma.Decimal.Value;
  tip_amount: Prisma.Decimal.Value;
  net_amount: Prisma.Decimal.Value;
  vat_amount: Prisma.Decimal.Value;
  status: string;
  refund_method: string;
  reason_code: string;
  reason_text: string;
  requested_by_staff_user_id: string | null;
  requested_by_role: string | null;
  credit_note_status: string;
  credit_note_folio: string | null;
  bill_id: string;
  payment_id: string;
  payment_method: string | null;
  provider: string;
  order_number: string;
  table_name: string | null;
  cashier_name: string | null;
  requested_by_name: string | null;
  approved_by_name: string | null;
  bill_has_active_orders: boolean;
};

export type RefundTotalRecord = {
  method: string | null;
  reason_code: string;
  requested_by_staff_user_id: string | null;
  requested_by_name: string | null;
  count: number;
  amount: Prisma.Decimal.Value;
  consumption: Prisma.Decimal.Value;
  tip: Prisma.Decimal.Value;
  net: Prisma.Decimal.Value;
  vat: Prisma.Decimal.Value;
};

export type RefundsByMethodRecord = {
  method: string;
  refunds: number;
  consumption: Prisma.Decimal.Value;
  tip: Prisma.Decimal.Value;
};

export type OrderDetailRefundRecord = {
  items?: RefundItemReportRecord[];
  id: string;
  payment_id: string;
  amount: Prisma.Decimal.Value;
  tip_amount: Prisma.Decimal.Value;
  net_amount: Prisma.Decimal.Value;
  vat_amount: Prisma.Decimal.Value;
  method: string;
  status: string;
  reason_code: string;
  reason_text: string;
  requested_by_staff_user_id: string | null;
  requested_by_name: string | null;
  approved_by_name: string | null;
  credit_note_status: string;
  completed_at: Date | null;
};

export type PaymentsPageFilter = PaymentsReportFilter & {
  orderBy: PaymentsOrderBy;
  direction: SortDirection;
};

export type BillRowRecord = {
  id: string;
  closed_at: Date;
  ticket_number: number | null;
  bill_number?: number | null;
  receipt_type?: string | null;
  receipt_folio?: number | null;
  guest_count: number | null;
  table_name: string | null;
  zone_name: string | null;
  waiter_name: string | null;
  discount_amount?: Prisma.Decimal.Value;
};

export type BillPaymentRecord = {
  id: string;
  bill_id: string;
  amount: Prisma.Decimal.Value;
  tip_amount: Prisma.Decimal.Value;
  refunded?: Prisma.Decimal.Value;
  refunded_tip?: Prisma.Decimal.Value;
  method: string | null;
  source: string | null;
  staff_name: string | null;
};

export type BillPageRecord = BillRowRecord & {
  bill_total: Prisma.Decimal.Value;
  bill_tip: Prisma.Decimal.Value;
  order_key: string;
  payments: BillPaymentRecord[];
};

export type MethodTotalRecord = {
  method: string;
  payments: number;
  consumption: Prisma.Decimal.Value;
  tip: Prisma.Decimal.Value;
  refunded?: Prisma.Decimal.Value;
  refunded_tip?: Prisma.Decimal.Value;
  bills?: number;
  discounts?: Prisma.Decimal.Value;
};

export type PaymentReportRecord = {
  kind: 'PAYMENT' | 'ATTEMPT';
  id: string;
  created_at: Date;
  paid_at: Date | null;
  event_at: Date;
  bill_id: string | null;
  order_number: string | null;
  table_name: string | null;
  method: string | null;
  provider: string;
  provider_reference: string | null;
  status: string;
  provider_status: string | null;
  provider_status_detail: string | null;
  failure_reason: string | null;
  amount: Prisma.Decimal.Value;
  tip: Prisma.Decimal.Value;
  source: string | null;
  staff_name: string | null;
  refunded?: Prisma.Decimal.Value;
  refunded_tip?: Prisma.Decimal.Value;
  refund_status?: string;
};

export type PaymentStatusTotalRecord = {
  kind: 'PAYMENT' | 'ATTEMPT';
  status: string;
  method: string | null;
  count: number;
  consumption: Prisma.Decimal.Value;
  tip: Prisma.Decimal.Value;
  refunded?: Prisma.Decimal.Value;
  refunded_tip?: Prisma.Decimal.Value;
};

export type HierarchyFilter = BillFilter & {
  includeModifiers: boolean;
};

export type CollectedBillLineRecord = HierarchyLineRecord & {
  bill_id: string;
  collected: Prisma.Decimal.Value;
};

export type HierarchyLineRecord = {
  category_path: string[] | null;
  item_name: string;
  station_name: string;
  amount: Prisma.Decimal.Value;
  quantity: number;
  cancelled_quantity: number;
};

export type OrderDetailHeaderRecord = {
  id: string;
  status: string;
  subtotal_amount: Prisma.Decimal.Value;
  tax_amount: Prisma.Decimal.Value;
  tip_amount: Prisma.Decimal.Value;
  total_amount: Prisma.Decimal.Value;
  remaining_amount: Prisma.Decimal.Value;
  discount_amount?: Prisma.Decimal.Value;
  refunded_amount?: Prisma.Decimal.Value;
  opened_at: Date;
  closed_at: Date | null;
  close_reason: string | null;
  ticket_number: number | null;
  guest_count: number | null;
  customer_label: string | null;
  is_counter: boolean;
  session_status: string;
  session_opened_at: Date;
  session_closed_at: Date | null;
  session_close_reason: string | null;
  table_id: string;
  table_name: string;
  zone_id: string | null;
  zone_name: string | null;
  waiter_id: string | null;
  waiter_name: string | null;
  opened_by_name: string | null;
  last_paid_at: Date | null;
};

export type OrderDetailItemRecord = {
  id: string;
  order_id: string;
  order_status: string;
  order_source: string;
  order_created_at: Date;
  order_notes: string | null;
  name: string;
  category_path: string[] | null;
  unit_price: Prisma.Decimal.Value;
  quantity: number;
  status: string;
  notes: string | null;
  station_name: string;
  menu_item_id: string | null;
  modifiers: {
    name: string;
    price_delta: string;
    path: string[] | null;
    depth: number | null;
  }[];
  discount_amount?: Prisma.Decimal.Value;
};

export type OrderDetailDiscountRecord = {
  id: string;
  bill_item_id: string | null;
  item_name: string | null;
  type: string;
  value: Prisma.Decimal.Value;
  amount: Prisma.Decimal.Value;
  reason_code: string;
  reason_text: string;
  applied_by_name: string | null;
  approved_by_name: string | null;
  voided_at: Date | null;
  void_reason: string | null;
  created_at: Date;
};

export type OrderDetailPaymentRecord = {
  id: string;
  method: string | null;
  provider: string;
  provider_reference: string | null;
  amount: Prisma.Decimal.Value;
  tip_amount: Prisma.Decimal.Value;
  status: string;
  paid_at: Date | null;
  created_at: Date;
  source: string | null;
  staff_user_id: string | null;
  staff_name: string | null;
  refunded_amount?: Prisma.Decimal.Value;
  refunded_tip_amount?: Prisma.Decimal.Value;
};

export type OrderDetailRecords = {
  header: OrderDetailHeaderRecord | null;
  items: OrderDetailItemRecord[];
  payments: OrderDetailPaymentRecord[];
  refunds?: OrderDetailRefundRecord[];
  discounts?: OrderDetailDiscountRecord[];
};

export type FilterOptionsRecord = {
  staff: {
    id: string;
    name: string | null;
    status: string;
    roles: string[];
    has_payments: boolean;
  }[];
  zones: { id: string; name: string }[];
  tables: {
    id: string;
    name: string;
    code: string;
    zone_id: string | null;
    is_virtual: boolean;
  }[];
  payments: {
    methods: string[] | null;
    has_unclassified: boolean | null;
    providers: string[] | null;
    sources: string[] | null;
  } | null;
  categories: { path: string[] | null; quantity: number }[];
  products: {
    id: string | null;
    name: string;
    path: string[] | null;
    quantity: number;
  }[];
};

const SORT_COLUMNS = {
  closedAt: { column: 'closed_at', cast: 'timestamptz' },
  total: { column: 'total', cast: 'numeric' },
  tip: { column: 'tip', cast: 'numeric' },
  orderNumber: { column: 'order_key', cast: 'text COLLATE "C"' },
} as const;

const REFUND_SORT_COLUMNS = {
  completedAt: { column: 'completed_at', cast: 'timestamptz' },
  amount: { column: 'amount', cast: 'numeric' },
} as const;

const PAYMENT_SORT_COLUMNS = {
  eventAt: { column: 'event_at', cast: 'timestamptz' },
  amount: { column: 'amount', cast: 'numeric' },
  tip: { column: 'tip', cast: 'numeric' },
} as const;

function keysetSql(
  alias: string,
  sort: { column: string; cast: string },
  direction: SortDirection,
  cursor: KeysetCursor | null,
): { where: Prisma.Sql; orderBy: Prisma.Sql } {
  const { order, compare } = directionSql(direction);
  const column = Prisma.raw(`${alias}.${sort.column}`);
  const id = Prisma.raw(`${alias}.id`);
  const value = Prisma.sql`${cursor?.value ?? ''}::${Prisma.raw(sort.cast)}`;

  return {
    where: cursor
      ? Prisma.sql`WHERE (${column} ${compare} ${value} OR (${column} = ${value} AND ${id} ${compare} ${cursor.id}::uuid))`
      : Prisma.empty,
    orderBy: Prisma.sql`ORDER BY ${column} ${order}, ${id} ${order}`,
  };
}

@Injectable()
export class ReportsPrismaRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findBranchTimezone(branchId: string): Promise<string | null> {
    const branch = await this.prisma.branch.findUnique({
      where: { id: branchId },
      select: { restaurant: { select: { timezone: true } } },
    });

    return branch?.restaurant.timezone ?? null;
  }

  findBillPage(
    filter: BillPageFilter,
    cursor: KeysetCursor | null,
    limit: number,
  ): Promise<BillPageRecord[]> {
    const sort = SORT_COLUMNS[filter.orderBy];
    const inner = keysetSql('e', sort, filter.direction, cursor);
    const outer = keysetSql('pg', sort, filter.direction, null);

    return this.prisma.$queryRaw<BillPageRecord[]>(Prisma.sql`
      SELECT
        pg.id::text AS id,
        pg.closed_at,
        pg.ticket_number,
        pg.bill_number,
        pg.receipt_type,
        pg.receipt_folio,
        pg.guest_count,
        pg.table_name,
        pg.zone_name,
        pg.waiter_name,
        pg.discount_amount,
        pg.total AS bill_total,
        pg.tip AS bill_tip,
        pg.order_key,
        pay.payments
      FROM (
        SELECT e.*
        FROM (${eligibleBillsSql(filter)}) e
        ${inner.where}
        ${inner.orderBy}
        LIMIT ${limit}
      ) pg
      LEFT JOIN LATERAL (
        SELECT COALESCE(
          json_agg(
            json_build_object(
              'id', p.id::text,
              'bill_id', pg.id::text,
              'amount', p.amount::text,
              'tip_amount', p.tip_amount::text,
              'refunded', COALESCE(rf.consumption, 0)::text,
              'refunded_tip', COALESCE(rf.tip, 0)::text,
              'method', p.method::text,
              'source', p.source,
              'staff_name', NULLIF(TRIM(CONCAT(su.first_name, ' ', su.last_name)), '')
            )
            ORDER BY p.paid_at ASC, p.id ASC
          ),
          '[]'::json
        ) AS payments
        FROM payments p
        LEFT JOIN staff_users su ON su.id = p.staff_user_id
        ${refundJoinSql(filter)}
        WHERE p.bill_id = pg.id AND ${paidPaymentConditionSql(filter)}
      ) pay ON TRUE
      ${outer.orderBy}
    `);
  }

  findMethodTotals(filter: BillFilter): Promise<MethodTotalRecord[]> {
    return this.prisma.$queryRaw<MethodTotalRecord[]>(Prisma.sql`
      WITH e AS (${eligibleBillsSql(filter)}),
      bill_count AS (
        SELECT COUNT(*)::int AS bills,
               COALESCE(SUM(discount_amount), 0) AS discounts
        FROM e
      )
      SELECT
        COALESCE(p.method::text, ${UNCLASSIFIED_METHOD}::text) AS method,
        COUNT(*)::int AS payments,
        COALESCE(SUM(p.amount - p.tip_amount), 0) AS consumption,
        COALESCE(SUM(p.tip_amount), 0) AS tip,
        COALESCE(SUM(rf.consumption), 0) AS refunded,
        COALESCE(SUM(rf.tip), 0) AS refunded_tip,
        (SELECT bills FROM bill_count) AS bills,
        (SELECT discounts FROM bill_count) AS discounts
      FROM e
      JOIN payments p ON p.bill_id = e.id AND ${paidPaymentConditionSql(filter)}
      ${refundJoinSql(filter)}
      GROUP BY 1
    `);
  }

  async findDiscountOnlyTotal(filter: BillFilter): Promise<Prisma.Decimal> {
    const rows = await this.prisma.$queryRaw<
      { amount: Prisma.Decimal.Value }[]
    >(Prisma.sql`
      SELECT COALESCE(SUM(discount_amount), 0) AS amount
      FROM (${discountOnlyBillsSql(filter)}) d
    `);

    return new Prisma.Decimal(rows[0]?.amount ?? 0);
  }

  findRefundsByMethod(
    filter: RefundsByMethodFilter,
  ): Promise<RefundsByMethodRecord[]> {
    return this.prisma.$queryRaw<RefundsByMethodRecord[]>(
      refundsByMethodSql(filter),
    );
  }

  async findPeriodRefundTotals(
    filter: BillFilter,
  ): Promise<{ consumption: Prisma.Decimal.Value; tip: Prisma.Decimal.Value }> {
    const rows = await this.prisma.$queryRaw<
      { consumption: Prisma.Decimal.Value; tip: Prisma.Decimal.Value }[]
    >(Prisma.sql`
      SELECT
        COALESCE(SUM(x.consumption - x.items_consumption), 0) AS consumption,
        COALESCE(SUM(x.tip), 0) AS tip
      FROM (${periodRefundsSql(filter)}) x
    `);

    return rows[0];
  }

  private async withRefundItems<T extends { id: string }>(
    refunds: T[],
  ): Promise<(T & { items: RefundItemReportRecord[] })[]> {
    if (refunds.length === 0) {
      return [];
    }

    const rows = await this.prisma.$queryRaw<
      (RefundItemReportRecord & { refund_id: string })[]
    >(Prisma.sql`
      SELECT
        ri.refund_id::text AS refund_id,
        ri.bill_item_id::text AS bill_item_id,
        ri.name_snapshot AS name,
        ri.quantity,
        ri.amount,
        ri.kitchen_waste
      FROM refund_items ri
      WHERE ri.refund_id IN (${Prisma.join(refunds.map((refund) => Prisma.sql`${refund.id}::uuid`))})
      ORDER BY ri.created_at ASC, ri.id ASC
    `);
    const byRefund = new Map<string, RefundItemReportRecord[]>();

    for (const { refund_id: refundId, ...item } of rows) {
      byRefund.set(refundId, [...(byRefund.get(refundId) ?? []), item]);
    }

    return refunds.map((refund) => ({
      ...refund,
      items: byRefund.get(refund.id) ?? [],
    }));
  }

  async findRefundsPage(
    filter: RefundsPageFilter,
    cursor: KeysetCursor | null,
    limit: number,
  ): Promise<RefundReportRecord[]> {
    const keyset = keysetSql(
      'x',
      REFUND_SORT_COLUMNS[filter.orderBy],
      filter.direction,
      cursor,
    );

    const refunds = await this.prisma.$queryRaw<
      RefundReportRecord[]
    >(Prisma.sql`
      SELECT
        x.id::text AS id,
        x.completed_at,
        x.amount,
        x.tip_amount,
        x.net_amount,
        x.vat_amount,
        x.status,
        x.refund_method,
        x.reason_code,
        x.reason_text,
        x.requested_by_staff_user_id::text AS requested_by_staff_user_id,
        x.requested_by_role,
        x.credit_note_status,
        x.credit_note_folio,
        x.bill_id::text AS bill_id,
        x.payment_id::text AS payment_id,
        x.payment_method,
        x.provider,
        x.order_number,
        x.table_name,
        x.cashier_name,
        x.requested_by_name,
        x.approved_by_name,
        x.bill_has_active_orders
      FROM (${refundsFilteredSql(filter)}) x
      ${keyset.where}
      ${keyset.orderBy}
      LIMIT ${limit}
    `);

    return this.withRefundItems(refunds);
  }

  findRefundTotals(filter: RefundsReportFilter): Promise<RefundTotalRecord[]> {
    return this.prisma.$queryRaw<RefundTotalRecord[]>(Prisma.sql`
      SELECT
        x.payment_method AS method,
        x.reason_code,
        x.requested_by_staff_user_id::text AS requested_by_staff_user_id,
        MAX(x.requested_by_name) AS requested_by_name,
        COUNT(*)::int AS count,
        COALESCE(SUM(x.amount), 0) AS amount,
        COALESCE(SUM(x.amount - x.tip_amount), 0) AS consumption,
        COALESCE(SUM(x.tip_amount), 0) AS tip,
        COALESCE(SUM(x.net_amount), 0) AS net,
        COALESCE(SUM(x.vat_amount), 0) AS vat
      FROM (${refundsFilteredSql(filter)}) x
      GROUP BY x.payment_method, x.reason_code, x.requested_by_staff_user_id
    `);
  }

  async findHierarchyLines(
    filter: HierarchyFilter,
  ): Promise<HierarchyLineRecord[]> {
    const [refundLines, lines] = await Promise.all([
      this.findRefundItemLines(filter),
      this.findSoldHierarchyLines(filter),
    ]);

    return [...lines, ...refundLines];
  }

  private findRefundItemLines(
    filter: HierarchyFilter,
  ): Promise<HierarchyLineRecord[]> {
    const modifierShare = filter.includeModifiers
      ? Prisma.sql`0`
      : Prisma.sql`ri.quantity * mods.delta`;

    return this.prisma.$queryRaw<HierarchyLineRecord[]>(Prisma.sql`
      SELECT
        ri.category_path_snapshot AS category_path,
        ri.name_snapshot AS item_name,
        COALESCE(ps.name, '-') AS station_name,
        -COALESCE(SUM(ri.amount - ${modifierShare}), 0) AS amount,
        (-COALESCE(SUM(ri.quantity), 0))::int AS quantity,
        0 AS cancelled_quantity
      FROM refund_items ri
      LEFT JOIN preparation_stations ps ON ps.id = ri.preparation_station_id
      LEFT JOIN LATERAL (
        SELECT COALESCE(SUM(m.price_delta_snapshot), 0) AS delta
        FROM order_item_modifiers m
        WHERE m.order_item_id = ri.order_item_id
      ) mods ON TRUE
      WHERE ri.refund_id IN (
        SELECT pr.refund_id FROM (${periodRefundsSql(filter)}) pr
      )
      GROUP BY ri.category_path_snapshot, ri.name_snapshot, ps.name
    `);
  }

  findSoldHierarchyLines(
    filter: HierarchyFilter,
  ): Promise<HierarchyLineRecord[]> {
    const unitPrice = filter.includeModifiers
      ? Prisma.sql`oi.price_snapshot`
      : Prisma.sql`(oi.price_snapshot - mods.delta)`;
    const sold = Prisma.sql`(oi.status::text <> 'CANCELLED' AND o.status::text IN (${Prisma.join(SOLD_ORDER_STATUSES)}))`;

    return this.prisma.$queryRaw<HierarchyLineRecord[]>(Prisma.sql`
      SELECT
        oi.category_path_snapshot AS category_path,
        oi.name_snapshot AS item_name,
        ps.name AS station_name,
        COALESCE(SUM(${unitPrice} * oi.quantity - COALESCE(bi.discount_amount, 0)) FILTER (WHERE ${sold}), 0) AS amount,
        COALESCE(SUM(oi.quantity) FILTER (WHERE ${sold}), 0)::int AS quantity,
        COALESCE(SUM(oi.quantity) FILTER (WHERE oi.status::text = 'CANCELLED'), 0)::int AS cancelled_quantity
      FROM (${eligibleBillsSql(filter)}) e
      JOIN orders o ON o.bill_id = e.id
      JOIN order_items oi ON oi.order_id = o.id
      JOIN preparation_stations ps ON ps.id = oi.preparation_station_id
      LEFT JOIN bill_items bi
        ON bi.order_item_id = oi.id AND bi.bill_id = e.id AND bi.status::text = 'OPEN'
      LEFT JOIN LATERAL (
        SELECT COALESCE(SUM(m.price_delta_snapshot), 0) AS delta
        FROM order_item_modifiers m
        WHERE m.order_item_id = oi.id
      ) mods ON TRUE
      GROUP BY oi.category_path_snapshot, oi.name_snapshot, ps.name
      HAVING COALESCE(SUM(oi.quantity) FILTER (WHERE ${sold}), 0) > 0
        OR COALESCE(SUM(oi.quantity) FILTER (WHERE oi.status::text = 'CANCELLED'), 0) > 0
    `);
  }

  findCollectedBillLines(
    filter: HierarchyFilter,
  ): Promise<CollectedBillLineRecord[]> {
    const unitPrice = filter.includeModifiers
      ? Prisma.sql`oi.price_snapshot`
      : Prisma.sql`(oi.price_snapshot - mods.delta)`;
    const sold = Prisma.sql`(oi.status::text <> 'CANCELLED' AND o.status::text IN (${Prisma.join(SOLD_ORDER_STATUSES)}))`;

    return this.prisma.$queryRaw<CollectedBillLineRecord[]>(Prisma.sql`
      SELECT
        e.id::text AS bill_id,
        e.total AS collected,
        oi.category_path_snapshot AS category_path,
        oi.name_snapshot AS item_name,
        ps.name AS station_name,
        COALESCE(SUM(${unitPrice} * oi.quantity - COALESCE(bi.discount_amount, 0)), 0) AS amount,
        COALESCE(SUM(oi.quantity), 0)::int AS quantity,
        0 AS cancelled_quantity
      FROM (${eligibleBillsSql(filter)}) e
      JOIN orders o ON o.bill_id = e.id
      JOIN order_items oi ON oi.order_id = o.id
      JOIN preparation_stations ps ON ps.id = oi.preparation_station_id
      LEFT JOIN bill_items bi
        ON bi.order_item_id = oi.id AND bi.bill_id = e.id AND bi.status::text = 'OPEN'
      LEFT JOIN LATERAL (
        SELECT COALESCE(SUM(m.price_delta_snapshot), 0) AS delta
        FROM order_item_modifiers m
        WHERE m.order_item_id = oi.id
      ) mods ON TRUE
      WHERE ${sold}
      GROUP BY e.id, e.total, oi.category_path_snapshot, oi.name_snapshot, ps.name
    `);
  }

  findPaymentsPage(
    filter: PaymentsPageFilter,
    cursor: KeysetCursor | null,
    limit: number,
  ): Promise<PaymentReportRecord[]> {
    const keyset = keysetSql(
      'r',
      PAYMENT_SORT_COLUMNS[filter.orderBy],
      filter.direction,
      cursor,
    );

    return this.prisma.$queryRaw<PaymentReportRecord[]>(Prisma.sql`
      SELECT
        r.kind,
        r.id::text AS id,
        r.created_at,
        r.paid_at,
        r.event_at,
        r.bill_id::text AS bill_id,
        r.order_number,
        r.table_name,
        r.method,
        r.provider,
        r.provider_reference,
        r.status,
        r.provider_status,
        r.provider_status_detail,
        r.failure_reason,
        r.amount,
        r.tip,
        r.source,
        r.refunded,
        r.refunded_tip,
        r.refund_status,
        r.staff_name
      FROM (${paymentsFilteredSql(filter)}) r
      ${keyset.where}
      ${keyset.orderBy}
      LIMIT ${limit}
    `);
  }

  findPaymentStatusTotals(
    filter: PaymentsReportFilter,
  ): Promise<PaymentStatusTotalRecord[]> {
    return this.prisma.$queryRaw<PaymentStatusTotalRecord[]>(Prisma.sql`
      SELECT
        r.kind,
        r.status,
        r.method,
        COUNT(*)::int AS count,
        COALESCE(SUM(r.amount), 0) AS consumption,
        COALESCE(SUM(r.tip), 0) AS tip,
        COALESCE(SUM(r.refunded), 0) AS refunded,
        COALESCE(SUM(r.refunded_tip), 0) AS refunded_tip
      FROM (${paymentsFilteredSql(filter)}) r
      GROUP BY r.kind, r.status, r.method
    `);
  }

  async findOrderDetail(
    branchId: string,
    billId: string,
    refundsOnlyRequestedBy: string | null = null,
  ): Promise<OrderDetailRecords> {
    const [headers, items, payments, refunds, discounts] = await Promise.all([
      this.prisma.$queryRaw<OrderDetailHeaderRecord[]>(Prisma.sql`
        SELECT
          b.id::text AS id,
          b.status::text AS status,
          b.subtotal_amount,
          b.tax_amount,
          b.tip_amount,
          b.total_amount,
          b.remaining_amount,
          b.discount_amount,
          b.refunded_amount,
          b.opened_at,
          b.closed_at,
          b.close_reason,
          ts.ticket_number,
          ts.guest_count,
          ts.customer_label,
          ts.is_counter,
          ts.status::text AS session_status,
          ts.opened_at AS session_opened_at,
          ts.closed_at AS session_closed_at,
          ts.close_reason AS session_close_reason,
          t.id::text AS table_id,
          t.name AS table_name,
          z.id::text AS zone_id,
          z.name AS zone_name,
          wu.id::text AS waiter_id,
          NULLIF(TRIM(CONCAT(wu.first_name, ' ', wu.last_name)), '') AS waiter_name,
          NULLIF(TRIM(CONCAT(ou.first_name, ' ', ou.last_name)), '') AS opened_by_name,
          (
            SELECT MAX(lp.paid_at)
            FROM payments lp
            WHERE lp.bill_id = b.id AND lp.status = 'PAID'
          ) AS last_paid_at
        FROM bills b
        JOIN table_sessions ts ON ts.id = b.table_session_id
        JOIN tables t ON t.id = ts.table_id
        LEFT JOIN table_zones z ON z.id = t.zone_id
        LEFT JOIN staff_users wu ON wu.id = ts.assigned_staff_user_id
        LEFT JOIN staff_users ou ON ou.id = ts.opened_by_staff_user_id
        WHERE b.id = ${billId}::uuid AND b.branch_id = ${branchId}::uuid
      `),
      this.prisma.$queryRaw<OrderDetailItemRecord[]>(Prisma.sql`
        SELECT
          oi.id::text AS id,
          o.id::text AS order_id,
          o.status::text AS order_status,
          o.source::text AS order_source,
          o.created_at AS order_created_at,
          o.notes AS order_notes,
          oi.name_snapshot AS name,
          oi.category_path_snapshot AS category_path,
          oi.price_snapshot AS unit_price,
          oi.quantity,
          oi.status::text AS status,
          oi.notes,
          ps.name AS station_name,
          oi.menu_item_id::text AS menu_item_id,
          COALESCE((
            SELECT bi.discount_amount FROM bill_items bi
            WHERE bi.order_item_id = oi.id AND bi.status::text = 'OPEN'
            LIMIT 1
          ), 0) AS discount_amount,
          COALESCE(
            json_agg(
              json_build_object('name', m.name_snapshot, 'price_delta', m.price_delta_snapshot::text, 'path', m.path_snapshot, 'depth', m.depth)
              ORDER BY m.depth ASC, m.created_at ASC, m.id ASC
            ) FILTER (WHERE m.id IS NOT NULL),
            '[]'::json
          ) AS modifiers
        FROM orders o
        JOIN order_items oi ON oi.order_id = o.id
        JOIN preparation_stations ps ON ps.id = oi.preparation_station_id
        LEFT JOIN order_item_modifiers m ON m.order_item_id = oi.id
        WHERE o.bill_id = ${billId}::uuid AND o.branch_id = ${branchId}::uuid
        GROUP BY o.id, oi.id, ps.id
        ORDER BY o.created_at ASC, oi.created_at ASC, oi.id ASC
      `),
      this.prisma.$queryRaw<OrderDetailPaymentRecord[]>(Prisma.sql`
        SELECT
          p.id::text AS id,
          p.method::text AS method,
          p.provider,
          p.provider_reference,
          p.amount,
          p.tip_amount,
          p.status::text AS status,
          p.paid_at,
          p.created_at,
          p.source,
          p.staff_user_id::text AS staff_user_id,
          NULLIF(TRIM(CONCAT(su.first_name, ' ', su.last_name)), '') AS staff_name,
          p.refunded_amount,
          p.refunded_tip_amount
        FROM payments p
        LEFT JOIN staff_users su ON su.id = p.staff_user_id
        WHERE p.bill_id = ${billId}::uuid
        ORDER BY COALESCE(p.paid_at, p.created_at) ASC, p.id ASC
      `),
      this.prisma.$queryRaw<OrderDetailRefundRecord[]>(Prisma.sql`
        SELECT
          r.id::text AS id,
          r.payment_id::text AS payment_id,
          r.amount,
          r.tip_amount,
          r.net_amount,
          r.vat_amount,
          r.method::text AS method,
          r.status::text AS status,
          r.reason_code::text AS reason_code,
          r.reason_text,
          r.requested_by_staff_user_id::text AS requested_by_staff_user_id,
          NULLIF(TRIM(CONCAT(ru.first_name, ' ', ru.last_name)), '') AS requested_by_name,
          NULLIF(TRIM(CONCAT(au.first_name, ' ', au.last_name)), '') AS approved_by_name,
          r.credit_note_status,
          r.completed_at
        FROM refunds r
        JOIN bills rb ON rb.id = r.bill_id
        LEFT JOIN staff_users ru ON ru.id = r.requested_by_staff_user_id
        LEFT JOIN staff_users au ON au.id = r.approved_by_staff_user_id
        WHERE r.bill_id = ${billId}::uuid
          AND rb.branch_id = ${branchId}::uuid
          ${
            refundsOnlyRequestedBy
              ? Prisma.sql`AND r.requested_by_staff_user_id = ${refundsOnlyRequestedBy}::uuid`
              : Prisma.empty
          }
        ORDER BY COALESCE(r.completed_at, r.created_at) ASC, r.id ASC
      `),
      this.prisma.$queryRaw<OrderDetailDiscountRecord[]>(Prisma.sql`
        SELECT
          d.id::text AS id,
          d.bill_item_id::text AS bill_item_id,
          bi.description AS item_name,
          d.type::text AS type,
          d.value,
          d.amount,
          d.reason_code::text AS reason_code,
          d.reason_text,
          NULLIF(TRIM(CONCAT(ab.first_name, ' ', ab.last_name)), '') AS applied_by_name,
          NULLIF(TRIM(CONCAT(ap.first_name, ' ', ap.last_name)), '') AS approved_by_name,
          d.voided_at,
          d.void_reason,
          d.created_at
        FROM bill_discounts d
        LEFT JOIN bill_items bi ON bi.id = d.bill_item_id
        LEFT JOIN staff_users ab ON ab.id = d.applied_by_staff_user_id
        LEFT JOIN staff_users ap ON ap.id = d.approved_by_staff_user_id
        WHERE d.bill_id = ${billId}::uuid AND d.branch_id = ${branchId}::uuid
        ORDER BY d.created_at ASC, d.id ASC
      `),
    ]);

    return {
      header: headers[0] ?? null,
      items,
      payments,
      refunds: await this.withRefundItems(refunds),
      discounts,
    };
  }

  async findFilterOptions(
    branchId: string,
    since: Date,
    onlyStaffUserId: string | null,
    limit: number,
  ): Promise<FilterOptionsRecord> {
    const staffScope = onlyStaffUserId
      ? Prisma.sql`su.id = ${onlyStaffUserId}::uuid`
      : Prisma.sql`TRUE`;
    const rows = await this.prisma.$queryRaw<
      { options: FilterOptionsRecord }[]
    >(
      Prisma.sql`
        WITH br AS (
          SELECT id, restaurant_id FROM branches WHERE id = ${branchId}::uuid
        ),
        sold AS (
          SELECT oi.menu_item_id, oi.name_snapshot, oi.category_path_snapshot, oi.quantity, oi.created_at
          FROM orders o
          JOIN order_items oi ON oi.order_id = o.id
          WHERE o.branch_id = ${branchId}::uuid
            AND o.created_at >= ${since}
            AND oi.status::text <> 'CANCELLED'
            AND o.status::text IN (${Prisma.join(SOLD_ORDER_STATUSES)})
        ),
        pm AS (
          SELECT
            ARRAY_AGG(DISTINCT p.method::text) FILTER (WHERE p.method IS NOT NULL) AS methods,
            COALESCE(BOOL_OR(p.method IS NULL), FALSE) AS has_unclassified,
            ARRAY_AGG(DISTINCT p.provider) AS providers,
            ARRAY_AGG(DISTINCT p.source) FILTER (WHERE p.source IS NOT NULL) AS sources
          FROM payments p
          JOIN bills b ON b.id = p.bill_id
          WHERE b.branch_id = ${branchId}::uuid
            AND p.status = 'PAID'
            AND p.paid_at >= ${since}
        )
        SELECT json_build_object(
          'staff', (
            SELECT COALESCE(json_agg(x ORDER BY x.name ASC NULLS LAST, x.id ASC), '[]'::json)
            FROM (
              SELECT
                su.id::text AS id,
                NULLIF(TRIM(CONCAT(su.first_name, ' ', su.last_name)), '') AS name,
                su.status::text AS status,
                COALESCE(ARRAY_AGG(DISTINCT r.role::text) FILTER (WHERE r.status = 'ACTIVE'), ARRAY[]::text[]) AS roles,
                EXISTS (
                  SELECT 1
                  FROM payments sp
                  JOIN bills sb ON sb.id = sp.bill_id
                  WHERE sp.staff_user_id = su.id AND sb.branch_id = br.id
                ) AS has_payments,
                COUNT(r.id)::int AS role_rows
              FROM br
              JOIN staff_users su ON su.restaurant_id = br.restaurant_id
              LEFT JOIN staff_user_branch_roles r ON r.staff_user_id = su.id AND r.branch_id = br.id
              WHERE ${staffScope}
              GROUP BY su.id, br.id
            ) x
            WHERE x.role_rows > 0 OR x.has_payments
          ),
          'zones', (
            SELECT COALESCE(json_agg(json_build_object('id', z.id::text, 'name', z.name) ORDER BY z.name ASC), '[]'::json)
            FROM table_zones z
            WHERE z.branch_id = ${branchId}::uuid
          ),
          'tables', (
            SELECT COALESCE(
              json_agg(
                json_build_object('id', t.id::text, 'name', t.name, 'code', t.code, 'zone_id', t.zone_id::text, 'is_virtual', t.is_virtual)
                ORDER BY t.name ASC, t.id ASC
              ),
              '[]'::json
            )
            FROM tables t
            WHERE t.branch_id = ${branchId}::uuid
          ),
          'payments', (SELECT row_to_json(pm) FROM pm),
          'categories', (
            SELECT COALESCE(json_agg(c ORDER BY c.quantity DESC, c.path ASC), '[]'::json)
            FROM (
              SELECT s.category_path_snapshot AS path, SUM(s.quantity)::int AS quantity
              FROM sold s
              GROUP BY s.category_path_snapshot
              ORDER BY SUM(s.quantity) DESC, s.category_path_snapshot ASC
              LIMIT ${limit}
            ) c
          ),
          'products', (
            SELECT COALESCE(json_agg(pr ORDER BY pr.quantity DESC, pr.name ASC), '[]'::json)
            FROM (
              SELECT
                s.name_snapshot AS name,
                s.category_path_snapshot AS path,
                SUM(s.quantity)::int AS quantity,
                (ARRAY_AGG(s.menu_item_id::text ORDER BY s.created_at DESC) FILTER (WHERE s.menu_item_id IS NOT NULL))[1] AS id
              FROM sold s
              GROUP BY s.name_snapshot, s.category_path_snapshot
              ORDER BY SUM(s.quantity) DESC, s.name_snapshot ASC
              LIMIT ${limit}
            ) pr
          )
        ) AS options
      `,
    );

    return rows[0].options;
  }
}

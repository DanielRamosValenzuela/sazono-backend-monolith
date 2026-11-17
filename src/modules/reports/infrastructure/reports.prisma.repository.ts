import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import {
  UNCLASSIFIED_METHOD,
  type KeysetCursor,
  type PaymentSqlFilter,
} from '../application/report-types';

export type BillPageFilter = PaymentSqlFilter & {
  branchId: string;
  start: Date;
  end: Date;
};

export type BillRowRecord = {
  id: string;
  closed_at: Date;
  ticket_number: number | null;
  guest_count: number | null;
  table_name: string | null;
  zone_name: string | null;
  waiter_name: string | null;
};

export type BillPaymentRecord = {
  id: string;
  bill_id: string;
  amount: Prisma.Decimal.Value;
  tip_amount: Prisma.Decimal.Value;
  method: string | null;
  source: string | null;
  staff_name: string | null;
};

export type MethodTotalRecord = {
  method: string;
  payments: number;
  consumption: Prisma.Decimal.Value;
  tip: Prisma.Decimal.Value;
};

export type PaymentsReportFilter = PaymentSqlFilter & {
  branchId: string;
  start: Date;
  end: Date;
  kind: 'payment' | 'attempt' | 'all';
  provider: string | null;
  status: string | null;
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
};

export type PaymentStatusTotalRecord = {
  kind: 'PAYMENT' | 'ATTEMPT';
  status: string;
  method: string | null;
  count: number;
  consumption: Prisma.Decimal.Value;
  tip: Prisma.Decimal.Value;
};

export type HierarchyFilter = {
  branchId: string;
  start: Date;
  end: Date;
  includeModifiers: boolean;
};

export type HierarchyLineRecord = {
  category_path: string[] | null;
  item_name: string;
  station_name: string;
  amount: Prisma.Decimal.Value;
  quantity: number;
  cancelled_quantity: number;
};

const SOLD_ORDER_STATUSES = [
  'CONFIRMED',
  'ROUTED',
  'IN_PREPARATION',
  'PARTIALLY_READY',
  'READY',
  'DELIVERED',
];

function joinAnd(conditions: Prisma.Sql[]): Prisma.Sql {
  return Prisma.join(conditions, ' AND ');
}

function methodConditionSql(
  methods: PaymentSqlFilter['methods'],
  column: Prisma.Sql,
): Prisma.Sql {
  const named = methods.filter((method) => method !== UNCLASSIFIED_METHOD);
  const alternatives: Prisma.Sql[] = [];

  if (named.length > 0) {
    alternatives.push(Prisma.sql`${column}::text IN (${Prisma.join(named)})`);
  }

  if (named.length < methods.length) {
    alternatives.push(Prisma.sql`${column} IS NULL`);
  }

  return Prisma.sql`(${Prisma.join(alternatives, ' OR ')})`;
}

function paidPaymentConditionSql(filter: PaymentSqlFilter): Prisma.Sql {
  const conditions: Prisma.Sql[] = [Prisma.sql`p.status = 'PAID'`];

  if (filter.cashierId) {
    conditions.push(Prisma.sql`p.staff_user_id = ${filter.cashierId}::uuid`);
  }

  if (filter.methods.length > 0) {
    conditions.push(methodConditionSql(filter.methods, Prisma.sql`p.method`));
  }

  return joinAnd(conditions);
}

function eligibleBillsSql(filter: BillPageFilter): Prisma.Sql {
  return Prisma.sql`
    SELECT b.id, eff.closed_at
    FROM bills b
    CROSS JOIN LATERAL (
      SELECT (
        SELECT MAX(lp.paid_at)
        FROM payments lp
        WHERE lp.bill_id = b.id AND lp.status = 'PAID'
      ) AS closed_at
    ) eff
    WHERE b.branch_id = ${filter.branchId}::uuid
      AND eff.closed_at >= ${filter.start}
      AND eff.closed_at < ${filter.end}
      AND EXISTS (
        SELECT 1 FROM payments p
        WHERE p.bill_id = b.id AND ${paidPaymentConditionSql(filter)}
      )
  `;
}

function paymentsUnionSql(filter: PaymentsReportFilter): Prisma.Sql {
  const paymentsOnly = filter.cashierId !== null || filter.methods.length > 0;
  const paymentConditions: Prisma.Sql[] = [
    Prisma.sql`b.branch_id = ${filter.branchId}::uuid`,
  ];

  if (filter.cashierId) {
    paymentConditions.push(
      Prisma.sql`p.staff_user_id = ${filter.cashierId}::uuid`,
    );
  }

  if (filter.methods.length > 0) {
    paymentConditions.push(
      methodConditionSql(filter.methods, Prisma.sql`p.method`),
    );
  }

  const paymentsSelect = Prisma.sql`
    SELECT
      'PAYMENT'::text AS kind,
      p.id,
      p.created_at,
      p.paid_at,
      COALESCE(p.paid_at, p.created_at) AS event_at,
      p.bill_id,
      p.method::text AS method,
      p.provider,
      p.provider_reference,
      p.status::text AS status,
      NULL::text AS provider_status,
      NULL::text AS provider_status_detail,
      NULL::text AS failure_reason,
      p.amount - p.tip_amount AS amount,
      p.tip_amount AS tip,
      p.staff_user_id,
      p.source
    FROM payments p
    JOIN bills b ON b.id = p.bill_id
    WHERE ${joinAnd(paymentConditions)}
  `;

  const attemptsSelect = Prisma.sql`
    SELECT
      'ATTEMPT'::text AS kind,
      a.id,
      a.created_at,
      NULL::timestamptz AS paid_at,
      a.created_at AS event_at,
      a.bill_id,
      NULL::text AS method,
      a.provider,
      a.provider_reference,
      a.status::text AS status,
      a.provider_status,
      a.provider_status_detail,
      a.failure_reason,
      COALESCE(a.amount, 0) - COALESCE(a.tip_amount, 0) AS amount,
      COALESCE(a.tip_amount, 0) AS tip,
      NULL::uuid AS staff_user_id,
      NULL::text AS source
    FROM payment_attempts a
    JOIN bills b ON b.id = a.bill_id
    WHERE b.branch_id = ${filter.branchId}::uuid
      AND NOT EXISTS (
        SELECT 1 FROM payments pa
        WHERE pa.payment_attempt_id = a.id
          OR (
            pa.bill_id = a.bill_id
            AND pa.provider_reference IS NOT NULL
            AND pa.provider_reference = a.provider_reference
          )
      )
  `;

  const selects: Prisma.Sql[] = [];

  if (filter.kind !== 'attempt') {
    selects.push(paymentsSelect);
  }

  if (filter.kind !== 'payment' && !paymentsOnly) {
    selects.push(attemptsSelect);
  }

  if (selects.length === 0) {
    selects.push(Prisma.sql`${paymentsSelect} AND FALSE`);
  }

  const outerConditions: Prisma.Sql[] = [
    Prisma.sql`u.event_at >= ${filter.start}`,
    Prisma.sql`u.event_at < ${filter.end}`,
  ];

  if (filter.provider) {
    outerConditions.push(Prisma.sql`u.provider = ${filter.provider}`);
  }

  if (filter.status) {
    outerConditions.push(Prisma.sql`u.status = ${filter.status}`);
  }

  return Prisma.sql`
    SELECT u.* FROM (${Prisma.join(selects, ' UNION ALL ')}) u
    WHERE ${joinAnd(outerConditions)}
  `;
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
  ): Promise<BillRowRecord[]> {
    const cursorSql = cursor
      ? Prisma.sql`WHERE (e.closed_at < ${cursor.at} OR (e.closed_at = ${cursor.at} AND e.id < ${cursor.id}::uuid))`
      : Prisma.empty;

    return this.prisma.$queryRaw<BillRowRecord[]>(Prisma.sql`
      SELECT
        e.id::text AS id,
        e.closed_at,
        ts.ticket_number,
        ts.guest_count,
        t.name AS table_name,
        z.name AS zone_name,
        NULLIF(TRIM(CONCAT(wu.first_name, ' ', wu.last_name)), '') AS waiter_name
      FROM (${eligibleBillsSql(filter)}) e
      JOIN bills b ON b.id = e.id
      JOIN table_sessions ts ON ts.id = b.table_session_id
      JOIN tables t ON t.id = ts.table_id
      LEFT JOIN table_zones z ON z.id = t.zone_id
      LEFT JOIN staff_users wu ON wu.id = ts.assigned_staff_user_id
      ${cursorSql}
      ORDER BY e.closed_at DESC, e.id DESC
      LIMIT ${limit}
    `);
  }

  findPaymentsForBills(
    billIds: string[],
    filter: PaymentSqlFilter,
  ): Promise<BillPaymentRecord[]> {
    if (billIds.length === 0) {
      return Promise.resolve([]);
    }

    return this.prisma.$queryRaw<BillPaymentRecord[]>(Prisma.sql`
      SELECT
        p.id::text AS id,
        p.bill_id::text AS bill_id,
        p.amount,
        p.tip_amount,
        p.method::text AS method,
        p.source,
        NULLIF(TRIM(CONCAT(su.first_name, ' ', su.last_name)), '') AS staff_name
      FROM payments p
      LEFT JOIN staff_users su ON su.id = p.staff_user_id
      WHERE p.bill_id IN (${Prisma.join(billIds.map((id) => Prisma.sql`${id}::uuid`))})
        AND ${paidPaymentConditionSql(filter)}
      ORDER BY p.paid_at ASC, p.id ASC
    `);
  }

  async countBills(filter: BillPageFilter): Promise<number> {
    const rows = await this.prisma.$queryRaw<{ total: number }[]>(Prisma.sql`
      SELECT COUNT(*)::int AS total FROM (${eligibleBillsSql(filter)}) e
    `);

    return rows[0]?.total ?? 0;
  }

  findMethodTotals(filter: BillPageFilter): Promise<MethodTotalRecord[]> {
    return this.prisma.$queryRaw<MethodTotalRecord[]>(Prisma.sql`
      SELECT
        COALESCE(p.method::text, ${UNCLASSIFIED_METHOD}) AS method,
        COUNT(*)::int AS payments,
        COALESCE(SUM(p.amount - p.tip_amount), 0) AS consumption,
        COALESCE(SUM(p.tip_amount), 0) AS tip
      FROM (${eligibleBillsSql(filter)}) e
      JOIN payments p ON p.bill_id = e.id AND ${paidPaymentConditionSql(filter)}
      GROUP BY 1
    `);
  }

  findHierarchyLines(filter: HierarchyFilter): Promise<HierarchyLineRecord[]> {
    const unitPrice = filter.includeModifiers
      ? Prisma.sql`oi.price_snapshot`
      : Prisma.sql`(oi.price_snapshot - mods.delta)`;
    const sold = Prisma.sql`(oi.status::text <> 'CANCELLED' AND o.status::text IN (${Prisma.join(SOLD_ORDER_STATUSES)}))`;

    return this.prisma.$queryRaw<HierarchyLineRecord[]>(Prisma.sql`
      SELECT
        oi.category_path_snapshot AS category_path,
        oi.name_snapshot AS item_name,
        ps.name AS station_name,
        COALESCE(SUM(${unitPrice} * oi.quantity) FILTER (WHERE ${sold}), 0) AS amount,
        COALESCE(SUM(oi.quantity) FILTER (WHERE ${sold}), 0)::int AS quantity,
        COALESCE(SUM(oi.quantity) FILTER (WHERE oi.status::text = 'CANCELLED'), 0)::int AS cancelled_quantity
      FROM (${eligibleBillsSql({
        branchId: filter.branchId,
        start: filter.start,
        end: filter.end,
        cashierId: null,
        methods: [],
      })}) e
      JOIN orders o ON o.bill_id = e.id
      JOIN order_items oi ON oi.order_id = o.id
      JOIN preparation_stations ps ON ps.id = oi.preparation_station_id
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

  findPaymentsPage(
    filter: PaymentsReportFilter,
    cursor: KeysetCursor | null,
    limit: number,
  ): Promise<PaymentReportRecord[]> {
    const cursorSql = cursor
      ? Prisma.sql`WHERE (r.event_at < ${cursor.at} OR (r.event_at = ${cursor.at} AND r.id < ${cursor.id}::uuid))`
      : Prisma.empty;

    return this.prisma.$queryRaw<PaymentReportRecord[]>(Prisma.sql`
      SELECT
        r.kind,
        r.id::text AS id,
        r.created_at,
        r.paid_at,
        r.event_at,
        r.bill_id::text AS bill_id,
        COALESCE(ts.ticket_number::text, UPPER(RIGHT(r.bill_id::text, 6))) AS order_number,
        t.name AS table_name,
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
        NULLIF(TRIM(CONCAT(su.first_name, ' ', su.last_name)), '') AS staff_name
      FROM (${paymentsUnionSql(filter)}) r
      LEFT JOIN bills b ON b.id = r.bill_id
      LEFT JOIN table_sessions ts ON ts.id = b.table_session_id
      LEFT JOIN tables t ON t.id = ts.table_id
      LEFT JOIN staff_users su ON su.id = r.staff_user_id
      ${cursorSql}
      ORDER BY r.event_at DESC, r.id DESC
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
        COALESCE(SUM(r.tip), 0) AS tip
      FROM (${paymentsUnionSql(filter)}) r
      GROUP BY r.kind, r.status, r.method
    `);
  }
}

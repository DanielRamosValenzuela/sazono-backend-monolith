import { Prisma } from '@prisma/client';
import { UNCATEGORIZED_LABEL } from '../application/hierarchy-tree';
import { escapeLike } from '../application/report-filters';
import {
  ACTIVE_ORDER_STATUS_NAMES,
  hasClosureFilters,
  SOLD_ORDER_STATUSES,
  UNCLASSIFIED_METHOD,
  type PaymentSqlFilter,
  type ReportFilters,
  type SalesOrderBy,
  type SortDirection,
} from '../application/report-types';

export type BillFilter = PaymentSqlFilter &
  ReportFilters & {
    branchId: string;
    start: Date;
    end: Date;
    timeZone: string;
  };

export type BillPageFilter = BillFilter & {
  orderBy: SalesOrderBy;
  direction: SortDirection;
};

export type PaymentsReportFilter = PaymentSqlFilter &
  ReportFilters & {
    branchId: string;
    start: Date;
    end: Date;
    timeZone: string;
    kind: 'payment' | 'attempt' | 'all';
    provider: string | null;
    status: string | null;
  };

export type RefundsReportFilter = {
  branchId: string;
  start: Date;
  end: Date;
  timeZone: string;
  scopedToStaffUserId: string | null;
  cashierId: string | null;
  requestedById: string | null;
  methods: PaymentSqlFilter['methods'];
  sources: PaymentSqlFilter['sources'];
  reasonCodes: string[];
  refundStatuses: string[];
  refundMethods: string[];
  waiterId: string | null;
  tableId: string | null;
  zoneId: string | null;
  minAmount: number | null;
  maxAmount: number | null;
  hasTip: boolean | null;
  minTip: number | null;
  timeFromMinute: number | null;
  timeToMinute: number | null;
  weekdays: number[];
  q: string | null;
};

export type RefundsByMethodFilter = PaymentSqlFilter &
  Pick<ReportFilters, 'waiterId' | 'tableId' | 'zoneId'> & {
    branchId: string;
    start: Date;
    end: Date;
    provider?: string | null;
  };

export function refundJoinSql(
  range: { start: Date; end: Date },
  payment = 'p',
  alias = 'rf',
): Prisma.Sql {
  const paymentId = Prisma.raw(`${payment}.id`);

  return Prisma.sql`LEFT JOIN LATERAL (
    SELECT
      COALESCE(SUM(rr.amount - rr.tip_amount), 0) AS consumption,
      COALESCE(SUM(rr.tip_amount), 0) AS tip
    FROM refunds rr
    WHERE rr.payment_id = ${paymentId}
      AND rr.status = 'SUCCEEDED'
      AND rr.completed_at >= ${range.start}
      AND rr.completed_at < ${range.end}
  ) ${Prisma.raw(alias)} ON TRUE`;
}

export function joinAnd(conditions: Prisma.Sql[]): Prisma.Sql {
  return Prisma.join(conditions, ' AND ');
}

export function directionSql(direction: SortDirection): {
  order: Prisma.Sql;
  compare: Prisma.Sql;
} {
  return direction === 'asc'
    ? { order: Prisma.raw('ASC'), compare: Prisma.raw('>') }
    : { order: Prisma.raw('DESC'), compare: Prisma.raw('<') };
}

export function ilike(column: Prisma.Sql, pattern: string): Prisma.Sql {
  return Prisma.sql`${column} ILIKE ${pattern} ESCAPE '!'`;
}

export function searchPattern(text: string): string {
  return `%${escapeLike(text)}%`;
}

export function methodConditionSql(
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

export function paidPaymentConditionSql(
  filter: PaymentSqlFilter,
  alias = 'p',
): Prisma.Sql {
  const column = (name: string): Prisma.Sql => Prisma.raw(`${alias}.${name}`);
  const conditions: Prisma.Sql[] = [Prisma.sql`${column('status')} = 'PAID'`];

  if (filter.cashierId) {
    conditions.push(
      Prisma.sql`${column('staff_user_id')} = ${filter.cashierId}::uuid`,
    );
  }

  if (filter.methods.length > 0) {
    conditions.push(methodConditionSql(filter.methods, column('method')));
  }

  if (filter.sources.length > 0) {
    conditions.push(
      Prisma.sql`${column('source')} IN (${Prisma.join(filter.sources)})`,
    );
  }

  return joinAnd(conditions);
}

export function timeConditionsSql(
  column: Prisma.Sql,
  filter: Pick<ReportFilters, 'timeFromMinute' | 'timeToMinute' | 'weekdays'>,
  timeZone: string,
): Prisma.Sql[] {
  const local = Prisma.sql`(${column} AT TIME ZONE ${timeZone}::text)`;
  const minute = Prisma.sql`(EXTRACT(HOUR FROM ${local})::int * 60 + EXTRACT(MINUTE FROM ${local})::int)`;
  const { timeFromMinute: from, timeToMinute: to } = filter;
  const conditions: Prisma.Sql[] = [];

  if (from !== null && to !== null && from > to) {
    conditions.push(
      Prisma.sql`(${minute} >= ${from}::int OR ${minute} <= ${to}::int)`,
    );
  } else {
    if (from !== null) {
      conditions.push(Prisma.sql`${minute} >= ${from}::int`);
    }

    if (to !== null) {
      conditions.push(Prisma.sql`${minute} <= ${to}::int`);
    }
  }

  if (filter.weekdays.length > 0) {
    conditions.push(
      Prisma.sql`EXTRACT(ISODOW FROM ${local})::int IN (${Prisma.join(filter.weekdays)})`,
    );
  }

  return conditions;
}

export function tipConditionsSql(
  tip: Prisma.Sql,
  filter: Pick<ReportFilters, 'hasTip' | 'minTip'>,
): Prisma.Sql[] {
  const conditions: Prisma.Sql[] = [];

  if (filter.hasTip === true) {
    conditions.push(Prisma.sql`${tip} > 0`);
  }

  if (filter.hasTip === false) {
    conditions.push(Prisma.sql`${tip} = 0`);
  }

  if (filter.minTip !== null) {
    conditions.push(Prisma.sql`${tip} >= ${filter.minTip}::numeric`);
  }

  return conditions;
}

export function amountConditionsSql(
  amount: Prisma.Sql,
  filter: Pick<ReportFilters, 'minAmount' | 'maxAmount'>,
): Prisma.Sql[] {
  const conditions: Prisma.Sql[] = [];

  if (filter.minAmount !== null) {
    conditions.push(Prisma.sql`${amount} >= ${filter.minAmount}::numeric`);
  }

  if (filter.maxAmount !== null) {
    conditions.push(Prisma.sql`${amount} <= ${filter.maxAmount}::numeric`);
  }

  return conditions;
}

function soldLineSql(): Prisma.Sql {
  return Prisma.sql`oi.status::text <> 'CANCELLED' AND o.status::text IN (${Prisma.join(SOLD_ORDER_STATUSES)})`;
}

function itemConditionSql(filter: ReportFilters): Prisma.Sql | null {
  const conditions: Prisma.Sql[] = [];

  if (filter.productId) {
    conditions.push(Prisma.sql`oi.menu_item_id = ${filter.productId}::uuid`);
  }

  if (filter.productName) {
    conditions.push(
      Prisma.sql`LOWER(oi.name_snapshot) = LOWER(${filter.productName}::text)`,
    );
  }

  if (filter.categoryPath) {
    const wanted = Prisma.sql`ARRAY[${Prisma.join(filter.categoryPath)}]::text[]`;
    const normalized = Prisma.sql`(CASE WHEN cardinality(oi.category_path_snapshot) = 0 THEN ARRAY[${UNCATEGORIZED_LABEL}]::text[] ELSE oi.category_path_snapshot END)`;

    conditions.push(
      Prisma.sql`${normalized}[1:cardinality(${wanted})] = ${wanted}`,
    );
  }

  if (conditions.length === 0) {
    return null;
  }

  return Prisma.sql`EXISTS (
    SELECT 1
    FROM orders o
    JOIN order_items oi ON oi.order_id = o.id
    WHERE o.bill_id = b.id AND ${soldLineSql()} AND ${joinAnd(conditions)}
  )`;
}

function billSearchSql(q: string, filter: PaymentSqlFilter): Prisma.Sql {
  const pattern = searchPattern(q);

  return Prisma.sql`(
    ${ilike(Prisma.sql`COALESCE(ts.ticket_number::text, UPPER(RIGHT(b.id::text, 6)))`, pattern)}
    OR ${ilike(Prisma.sql`t.name`, pattern)}
    OR ${ilike(Prisma.sql`ts.customer_label`, pattern)}
    OR ${ilike(Prisma.sql`CONCAT(wu.first_name, ' ', wu.last_name)`, pattern)}
    OR EXISTS (
      SELECT 1
      FROM payments qp
      JOIN staff_users qs ON qs.id = qp.staff_user_id
      WHERE qp.bill_id = b.id
        AND ${paidPaymentConditionSql(filter, 'qp')}
        AND ${ilike(Prisma.sql`CONCAT(qs.first_name, ' ', qs.last_name)`, pattern)}
    )
  )`;
}

function billConditionsSql(filter: BillFilter): Prisma.Sql[] {
  const conditions: Prisma.Sql[] = [];

  if (filter.waiterId) {
    conditions.push(
      Prisma.sql`ts.assigned_staff_user_id = ${filter.waiterId}::uuid`,
    );
  }

  if (filter.tableId) {
    conditions.push(Prisma.sql`t.id = ${filter.tableId}::uuid`);
  }

  if (filter.zoneId) {
    conditions.push(Prisma.sql`t.zone_id = ${filter.zoneId}::uuid`);
  }

  const wantsFull = filter.billStatuses.includes('PAID_FULL');
  const wantsMixed = filter.billStatuses.includes('MIXED');

  if (wantsFull && !wantsMixed) {
    conditions.push(Prisma.sql`agg.method_count <= 1`);
  }

  if (wantsMixed && !wantsFull) {
    conditions.push(Prisma.sql`agg.method_count > 1`);
  }

  conditions.push(
    ...amountConditionsSql(Prisma.sql`agg.total`, filter),
    ...tipConditionsSql(Prisma.sql`agg.tip`, filter),
    ...timeConditionsSql(Prisma.sql`eff.closed_at`, filter, filter.timeZone),
  );

  if (filter.q) {
    conditions.push(billSearchSql(filter.q, filter));
  }

  const item = itemConditionSql(filter);

  if (item) {
    conditions.push(item);
  }

  return conditions;
}

export function eligibleBillsSql(filter: BillFilter): Prisma.Sql {
  const extra = billConditionsSql(filter);

  return Prisma.sql`
    SELECT
      b.id,
      eff.closed_at,
      agg.total,
      agg.tip,
      agg.refunded,
      agg.tip_refunded,
      agg.method_count,
      CASE WHEN b.status = 'PAID' THEN b.discount_amount ELSE 0 END AS discount_amount,
      COALESCE(LPAD(ts.ticket_number::text, 10, '0'), UPPER(RIGHT(b.id::text, 6))) COLLATE "C" AS order_key,
      ts.ticket_number,
      b.number AS bill_number,
      rc.receipt_type,
      rc.receipt_folio,
      ts.guest_count,
      t.name AS table_name,
      z.name AS zone_name,
      NULLIF(TRIM(CONCAT(wu.first_name, ' ', wu.last_name)), '') AS waiter_name
    FROM bills b
    JOIN table_sessions ts ON ts.id = b.table_session_id
    LEFT JOIN LATERAL (
      SELECT td.type::text AS receipt_type, td.folio AS receipt_folio
      FROM tax_documents td
      WHERE td.bill_id = b.id
        AND td.type IN ('BOLETA_AFECTA', 'BOLETA_EXENTA')
        AND td.status = 'ISSUED'
      ORDER BY td.issued_at DESC NULLS LAST, td.id DESC
      LIMIT 1
    ) rc ON TRUE
    JOIN tables t ON t.id = ts.table_id
    LEFT JOIN table_zones z ON z.id = t.zone_id
    LEFT JOIN staff_users wu ON wu.id = ts.assigned_staff_user_id
    CROSS JOIN LATERAL (
      SELECT MAX(lp.paid_at) AS closed_at
      FROM payments lp
      WHERE lp.bill_id = b.id AND lp.status = 'PAID'
    ) eff
    CROSS JOIN LATERAL (
      SELECT
        COUNT(*)::int AS payments_count,
        SUM(p.amount - p.tip_amount) AS total,
        SUM(p.tip_amount) AS tip,
        COALESCE(SUM(rf.consumption), 0) AS refunded,
        COALESCE(SUM(rf.tip), 0) AS tip_refunded,
        COUNT(DISTINCT COALESCE(p.method::text, ${UNCLASSIFIED_METHOD}::text))::int AS method_count
      FROM payments p
      ${refundJoinSql(filter)}
      WHERE p.bill_id = b.id AND ${paidPaymentConditionSql(filter)}
    ) agg
    WHERE b.branch_id = ${filter.branchId}::uuid
      AND eff.closed_at >= ${filter.start}
      AND eff.closed_at < ${filter.end}
      AND EXISTS (
        SELECT 1
        FROM payments rp
        WHERE rp.bill_id = b.id
          AND rp.status = 'PAID'
          AND rp.paid_at >= ${filter.start}
          AND rp.paid_at < ${filter.end}
      )
      AND agg.payments_count > 0
      ${extra.length > 0 ? Prisma.sql`AND ${joinAnd(extra)}` : Prisma.empty}
  `;
}

export function discountOnlyBillsSql(filter: BillFilter): Prisma.Sql {
  const paymentScoped =
    filter.cashierId !== null ||
    filter.methods.length > 0 ||
    filter.sources.length > 0 ||
    filter.billStatuses.length > 0;

  return Prisma.sql`
    SELECT b.id, b.discount_amount
    FROM bills b
    JOIN table_sessions ts ON ts.id = b.table_session_id
    JOIN tables t ON t.id = ts.table_id
    WHERE b.branch_id = ${filter.branchId}::uuid
      AND b.status = 'PAID'
      AND b.discount_amount > 0
      AND b.updated_at >= ${filter.start}
      AND b.updated_at < ${filter.end}
      AND ${paymentScoped ? Prisma.sql`FALSE` : Prisma.sql`TRUE`}
      AND NOT EXISTS (SELECT 1 FROM payments np WHERE np.bill_id = b.id)
      ${filter.waiterId ? Prisma.sql`AND ts.assigned_staff_user_id = ${filter.waiterId}::uuid` : Prisma.empty}
      ${filter.tableId ? Prisma.sql`AND t.id = ${filter.tableId}::uuid` : Prisma.empty}
      ${filter.zoneId ? Prisma.sql`AND t.zone_id = ${filter.zoneId}::uuid` : Prisma.empty}
  `;
}

export function discountBillsSql(filter: BillFilter): Prisma.Sql {
  return Prisma.sql`
    SELECT e.id, e.discount_amount FROM (${eligibleBillsSql(filter)}) e
    UNION ALL
    ${discountOnlyBillsSql(filter)}
  `;
}

export function paymentsFilteredSql(filter: PaymentsReportFilter): Prisma.Sql {
  const paymentsOnly =
    filter.cashierId !== null ||
    filter.methods.length > 0 ||
    filter.sources.length > 0;
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

  if (filter.sources.length > 0) {
    paymentConditions.push(
      Prisma.sql`p.source IN (${Prisma.join(filter.sources)})`,
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
      p.source,
      COALESCE(rf.consumption, 0) AS refunded,
      COALESCE(rf.tip, 0) AS refunded_tip,
      CASE
        WHEN p.refunded_amount <= 0 THEN 'NONE'
        WHEN p.refunded_amount >= p.amount THEN 'FULL'
        ELSE 'PARTIAL'
      END AS refund_status
    FROM payments p
    JOIN bills b ON b.id = p.bill_id
    ${refundJoinSql(filter)}
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
      NULL::text AS source,
      0::numeric AS refunded,
      0::numeric AS refunded_tip,
      'NONE'::text AS refund_status
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

  if (filter.waiterId) {
    outerConditions.push(
      Prisma.sql`ts.assigned_staff_user_id = ${filter.waiterId}::uuid`,
    );
  }

  if (filter.tableId) {
    outerConditions.push(Prisma.sql`t.id = ${filter.tableId}::uuid`);
  }

  if (filter.zoneId) {
    outerConditions.push(Prisma.sql`t.zone_id = ${filter.zoneId}::uuid`);
  }

  outerConditions.push(
    ...amountConditionsSql(Prisma.sql`u.amount`, filter),
    ...tipConditionsSql(Prisma.sql`u.tip`, filter),
    ...timeConditionsSql(Prisma.sql`u.event_at`, filter, filter.timeZone),
  );

  if (filter.q) {
    const pattern = searchPattern(filter.q);

    outerConditions.push(Prisma.sql`(
      ${ilike(Prisma.sql`COALESCE(ts.ticket_number::text, UPPER(RIGHT(u.bill_id::text, 6)))`, pattern)}
      OR ${ilike(Prisma.sql`t.name`, pattern)}
      OR ${ilike(Prisma.sql`ts.customer_label`, pattern)}
      OR ${ilike(Prisma.sql`CONCAT(su.first_name, ' ', su.last_name)`, pattern)}
      OR ${ilike(Prisma.sql`CONCAT(wu.first_name, ' ', wu.last_name)`, pattern)}
      OR ${ilike(Prisma.sql`u.provider_reference`, pattern)}
    )`);
  }

  return Prisma.sql`
    SELECT
      u.kind,
      u.id,
      u.created_at,
      u.paid_at,
      u.event_at,
      u.bill_id,
      COALESCE(ts.ticket_number::text, UPPER(RIGHT(u.bill_id::text, 6))) AS order_number,
      t.name AS table_name,
      u.method,
      u.provider,
      u.provider_reference,
      u.status,
      u.provider_status,
      u.provider_status_detail,
      u.failure_reason,
      u.amount,
      u.tip,
      u.source,
      u.refunded,
      u.refunded_tip,
      u.refund_status,
      NULLIF(TRIM(CONCAT(su.first_name, ' ', su.last_name)), '') AS staff_name
    FROM (${Prisma.join(selects, ' UNION ALL ')}) u
    JOIN bills b ON b.id = u.bill_id
    JOIN table_sessions ts ON ts.id = b.table_session_id
    JOIN tables t ON t.id = ts.table_id
    LEFT JOIN staff_users su ON su.id = u.staff_user_id
    LEFT JOIN staff_users wu ON wu.id = ts.assigned_staff_user_id
    WHERE ${joinAnd(outerConditions)}
  `;
}

function periodRefundConditionsSql(
  filter: RefundsByMethodFilter,
): Prisma.Sql[] {
  const conditions: Prisma.Sql[] = [
    Prisma.sql`r.branch_id = ${filter.branchId}::uuid`,
    Prisma.sql`r.status = 'SUCCEEDED'`,
    Prisma.sql`r.completed_at >= ${filter.start}`,
    Prisma.sql`r.completed_at < ${filter.end}`,
    paidPaymentConditionSql(filter),
  ];

  if (filter.provider) {
    conditions.push(Prisma.sql`p.provider = ${filter.provider}`);
  }

  if (filter.waiterId) {
    conditions.push(
      Prisma.sql`ts.assigned_staff_user_id = ${filter.waiterId}::uuid`,
    );
  }

  if (filter.tableId) {
    conditions.push(Prisma.sql`t.id = ${filter.tableId}::uuid`);
  }

  if (filter.zoneId) {
    conditions.push(Prisma.sql`t.zone_id = ${filter.zoneId}::uuid`);
  }

  return conditions;
}

export function refundsByMethodSql(filter: RefundsByMethodFilter): Prisma.Sql {
  return Prisma.sql`
    SELECT
      COALESCE(p.method::text, ${UNCLASSIFIED_METHOD}::text) AS method,
      COUNT(*)::int AS refunds,
      COALESCE(SUM(r.amount - r.tip_amount), 0) AS consumption,
      COALESCE(SUM(r.tip_amount), 0) AS tip
    FROM refunds r
    JOIN payments p ON p.id = r.payment_id
    JOIN bills b ON b.id = p.bill_id
    JOIN table_sessions ts ON ts.id = b.table_session_id
    JOIN tables t ON t.id = ts.table_id
    WHERE ${joinAnd(periodRefundConditionsSql(filter))}
    GROUP BY 1
  `;
}

export function periodRefundsSql(filter: BillFilter): Prisma.Sql {
  const conditions = periodRefundConditionsSql(filter);

  if (hasClosureFilters(filter)) {
    conditions.push(
      Prisma.sql`b.id IN (SELECT ce.id FROM (${eligibleBillsSql(filter)}) ce)`,
    );
  }

  return Prisma.sql`
    SELECT
      r.id AS refund_id,
      (r.amount - r.tip_amount) AS consumption,
      COALESCE((SELECT SUM(ri.amount) FROM refund_items ri WHERE ri.refund_id = r.id), 0) AS items_consumption,
      r.tip_amount AS tip,
      r.completed_at,
      p.method::text AS method,
      p.staff_user_id::text AS cashier_id,
      (p.staff_user_id IS NULL AND p.source = 'WEB_QR') AS online,
      COALESCE(ts.assigned_staff_user_id, ts.opened_by_staff_user_id, oc.staff_id)::text AS waiter_id
    FROM refunds r
    JOIN payments p ON p.id = r.payment_id
    JOIN bills b ON b.id = p.bill_id
    JOIN table_sessions ts ON ts.id = b.table_session_id
    JOIN tables t ON t.id = ts.table_id
    LEFT JOIN LATERAL (
      SELECT o.created_by_staff_user_id AS staff_id
      FROM orders o
      WHERE o.bill_id = b.id AND o.created_by_staff_user_id IS NOT NULL
      ORDER BY o.created_at ASC, o.id ASC
      LIMIT 1
    ) oc ON TRUE
    WHERE ${joinAnd(conditions)}
  `;
}

export function refundsFilteredSql(filter: RefundsReportFilter): Prisma.Sql {
  const conditions: Prisma.Sql[] = [
    Prisma.sql`r.branch_id = ${filter.branchId}::uuid`,
    Prisma.sql`r.completed_at >= ${filter.start}`,
    Prisma.sql`r.completed_at < ${filter.end}`,
  ];

  if (filter.scopedToStaffUserId) {
    conditions.push(
      Prisma.sql`r.requested_by_staff_user_id = ${filter.scopedToStaffUserId}::uuid`,
    );
  }

  if (filter.refundStatuses.length > 0) {
    conditions.push(
      Prisma.sql`r.status::text IN (${Prisma.join(filter.refundStatuses)})`,
    );
  }

  if (filter.reasonCodes.length > 0) {
    conditions.push(
      Prisma.sql`r.reason_code::text IN (${Prisma.join(filter.reasonCodes)})`,
    );
  }

  if (filter.refundMethods.length > 0) {
    conditions.push(
      Prisma.sql`r.method::text IN (${Prisma.join(filter.refundMethods)})`,
    );
  }

  if (filter.requestedById) {
    conditions.push(
      Prisma.sql`r.requested_by_staff_user_id = ${filter.requestedById}::uuid`,
    );
  }

  if (filter.cashierId) {
    conditions.push(Prisma.sql`p.staff_user_id = ${filter.cashierId}::uuid`);
  }

  if (filter.methods.length > 0) {
    conditions.push(methodConditionSql(filter.methods, Prisma.sql`p.method`));
  }

  if (filter.sources.length > 0) {
    conditions.push(Prisma.sql`p.source IN (${Prisma.join(filter.sources)})`);
  }

  if (filter.waiterId) {
    conditions.push(
      Prisma.sql`ts.assigned_staff_user_id = ${filter.waiterId}::uuid`,
    );
  }

  if (filter.tableId) {
    conditions.push(Prisma.sql`t.id = ${filter.tableId}::uuid`);
  }

  if (filter.zoneId) {
    conditions.push(Prisma.sql`t.zone_id = ${filter.zoneId}::uuid`);
  }

  conditions.push(
    ...amountConditionsSql(Prisma.sql`r.amount`, filter),
    ...tipConditionsSql(Prisma.sql`r.tip_amount`, filter),
    ...timeConditionsSql(Prisma.sql`r.completed_at`, filter, filter.timeZone),
  );

  if (filter.q) {
    const pattern = searchPattern(filter.q);

    conditions.push(Prisma.sql`(
      ${ilike(Prisma.sql`COALESCE(ts.ticket_number::text, UPPER(RIGHT(b.id::text, 6)))`, pattern)}
      OR ${ilike(Prisma.sql`t.name`, pattern)}
      OR ${ilike(Prisma.sql`ts.customer_label`, pattern)}
      OR ${ilike(Prisma.sql`CONCAT(cu.first_name, ' ', cu.last_name)`, pattern)}
      OR ${ilike(Prisma.sql`CONCAT(wu.first_name, ' ', wu.last_name)`, pattern)}
      OR ${ilike(Prisma.sql`CONCAT(ru.first_name, ' ', ru.last_name)`, pattern)}
      OR ${ilike(Prisma.sql`r.reason_text`, pattern)}
    )`);
  }

  return Prisma.sql`
    SELECT
      r.id,
      r.completed_at,
      r.amount,
      r.tip_amount,
      r.net_amount,
      r.vat_amount,
      r.status::text AS status,
      r.method::text AS refund_method,
      r.reason_code::text AS reason_code,
      r.reason_text,
      r.requested_by_staff_user_id,
      r.requested_by_role::text AS requested_by_role,
      r.credit_note_status,
      r.credit_note_folio,
      r.bill_id,
      r.payment_id,
      p.method::text AS payment_method,
      p.provider,
      COALESCE(ts.ticket_number::text, UPPER(RIGHT(b.id::text, 6))) AS order_number,
      t.name AS table_name,
      NULLIF(TRIM(CONCAT(cu.first_name, ' ', cu.last_name)), '') AS cashier_name,
      NULLIF(TRIM(CONCAT(ru.first_name, ' ', ru.last_name)), '') AS requested_by_name,
      NULLIF(TRIM(CONCAT(au.first_name, ' ', au.last_name)), '') AS approved_by_name,
      EXISTS (
        SELECT 1
        FROM orders ao
        WHERE ao.bill_id = b.id
          AND ao.status::text IN (${Prisma.join(ACTIVE_ORDER_STATUS_NAMES)})
      ) AS bill_has_active_orders
    FROM refunds r
    JOIN payments p ON p.id = r.payment_id
    JOIN bills b ON b.id = r.bill_id
    JOIN table_sessions ts ON ts.id = b.table_session_id
    JOIN tables t ON t.id = ts.table_id
    LEFT JOIN staff_users cu ON cu.id = p.staff_user_id
    LEFT JOIN staff_users wu ON wu.id = ts.assigned_staff_user_id
    LEFT JOIN staff_users ru ON ru.id = r.requested_by_staff_user_id
    LEFT JOIN staff_users au ON au.id = r.approved_by_staff_user_id
    WHERE ${joinAnd(conditions)}
  `;
}

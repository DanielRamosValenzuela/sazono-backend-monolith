import { Prisma } from '@prisma/client';
import { UNCATEGORIZED_LABEL } from '../application/hierarchy-tree';
import { escapeLike } from '../application/report-filters';
import {
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
      agg.method_count,
      COALESCE(LPAD(ts.ticket_number::text, 10, '0'), UPPER(RIGHT(b.id::text, 6))) COLLATE "C" AS order_key,
      ts.ticket_number,
      ts.guest_count,
      t.name AS table_name,
      z.name AS zone_name,
      NULLIF(TRIM(CONCAT(wu.first_name, ' ', wu.last_name)), '') AS waiter_name
    FROM bills b
    JOIN table_sessions ts ON ts.id = b.table_session_id
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
        COUNT(DISTINCT COALESCE(p.method::text, ${UNCLASSIFIED_METHOD}::text))::int AS method_count
      FROM payments p
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

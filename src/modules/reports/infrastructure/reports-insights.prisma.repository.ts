import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { UNCLASSIFIED_METHOD } from '../application/report-types';
import {
  eligibleBillsSql,
  paidPaymentConditionSql,
  periodRefundsSql,
  type BillFilter,
} from './report-sql';

export const CARD_TIP_METHODS = [
  'CREDIT_CARD',
  'DEBIT_CARD',
  'MERCADO_PAGO',
  'MACH',
] as const;

export const OPEN_TAB_KINDS = ['open', 'abandoned', 'cancelled'] as const;
export type OpenTabKind = (typeof OPEN_TAB_KINDS)[number];

export const TIME_BUCKETS = ['hour', 'weekday', 'day', 'month'] as const;
export type TimeBucket = (typeof TIME_BUCKETS)[number];

export type MethodBreakdownRecord = {
  method: string;
  payments: number;
  bills: number;
  amount: Prisma.Decimal.Value;
  tip: Prisma.Decimal.Value;
  refunded: Prisma.Decimal.Value;
};

export type StaffBreakdownRecord = {
  staff_id: string | null;
  online: boolean;
  name: string | null;
  bills: number;
  guests: number;
  amount: Prisma.Decimal.Value;
  tip: Prisma.Decimal.Value;
  refunded: Prisma.Decimal.Value;
};

export type HourWeekdayRecord = {
  weekday: number;
  hour: number;
  bills: number;
  guests: number;
  amount: Prisma.Decimal.Value;
  tip: Prisma.Decimal.Value;
  refunded: Prisma.Decimal.Value;
};

export type PeriodBucketRecord = {
  bucket: string;
  bills: number;
  guests: number;
  amount: Prisma.Decimal.Value;
  tip: Prisma.Decimal.Value;
  refunded: Prisma.Decimal.Value;
};

export type TipDayRecord = {
  staff_id: string | null;
  name: string | null;
  day: string;
  bills: number;
  sales: Prisma.Decimal.Value;
  tip: Prisma.Decimal.Value;
  returned: Prisma.Decimal.Value;
};

export type TipPayoutRecord = {
  staff_id: string | null;
  paid_day: string;
  card_tip: Prisma.Decimal.Value;
  card_tip_owed: Prisma.Decimal.Value;
  cash_tip: Prisma.Decimal.Value;
  total_tip: Prisma.Decimal.Value;
};

export type OpenTabRecord = {
  session_id: string;
  bill_id: string | null;
  ticket_number: number | null;
  is_counter: boolean;
  customer_label: string | null;
  guest_count: number | null;
  session_status: string;
  bill_status: string | null;
  table_name: string;
  zone_name: string | null;
  waiter_name: string | null;
  opened_at: Date;
  ended_at: Date | null;
  close_reason: string | null;
  total: Prisma.Decimal.Value;
  paid: Prisma.Decimal.Value;
  pending: Prisma.Decimal.Value;
  cancelled_orders: number | null;
  cancelled_amount: Prisma.Decimal.Value | null;
};

export type OpenTabsFilter = {
  kind: OpenTabKind;
  branchId: string;
  start: Date;
  end: Date;
  waiterId: string | null;
  tableId: string | null;
  zoneId: string | null;
  limit: number;
};

export type KpiTotalsRecord = {
  bills: number;
  table_bills: number;
  guests: number;
  gross: Prisma.Decimal.Value;
  tip: Prisma.Decimal.Value;
  refunded: Prisma.Decimal.Value;
};

const DAY_FORMAT = 'YYYY-MM-DD';
const MONTH_FORMAT = 'YYYY-MM';

function waiterBillsSql(filter: BillFilter): Prisma.Sql {
  return Prisma.sql`
    SELECT
      e.*,
      COALESCE(ts.assigned_staff_user_id, ts.opened_by_staff_user_id, oc.staff_id) AS waiter_id
    FROM (${eligibleBillsSql(filter)}) e
    JOIN bills b ON b.id = e.id
    JOIN table_sessions ts ON ts.id = b.table_session_id
    LEFT JOIN LATERAL (
      SELECT o.created_by_staff_user_id AS staff_id
      FROM orders o
      WHERE o.bill_id = b.id AND o.created_by_staff_user_id IS NOT NULL
      ORDER BY o.created_at ASC, o.id ASC
      LIMIT 1
    ) oc ON TRUE
  `;
}

function localDaySql(column: Prisma.Sql, timeZone: string): Prisma.Sql {
  return Prisma.sql`to_char(${column} AT TIME ZONE ${timeZone}::text, ${DAY_FORMAT}::text)`;
}

@Injectable()
export class ReportsInsightsPrismaRepository {
  constructor(private readonly prisma: PrismaService) {}

  findMethodBreakdown(filter: BillFilter): Promise<MethodBreakdownRecord[]> {
    return this.prisma.$queryRaw<MethodBreakdownRecord[]>(Prisma.sql`
      SELECT
        u.method,
        SUM(u.payments)::int AS payments,
        SUM(u.bills)::int AS bills,
        SUM(u.amount) AS amount,
        SUM(u.tip) AS tip,
        SUM(u.refunded) AS refunded
      FROM (
        SELECT
          COALESCE(p.method::text, ${UNCLASSIFIED_METHOD}::text) AS method,
          COUNT(*)::int AS payments,
          COUNT(DISTINCT e.id)::int AS bills,
          COALESCE(SUM(p.amount - p.tip_amount), 0) AS amount,
          COALESCE(SUM(p.tip_amount), 0) AS tip,
          0::numeric AS refunded
        FROM (${eligibleBillsSql(filter)}) e
        JOIN payments p ON p.bill_id = e.id AND ${paidPaymentConditionSql(filter)}
        GROUP BY 1
        UNION ALL
        SELECT
          COALESCE(x.method, ${UNCLASSIFIED_METHOD}::text),
          0,
          0,
          0::numeric,
          0::numeric,
          COALESCE(SUM(x.consumption), 0)
        FROM (${periodRefundsSql(filter)}) x
        WHERE x.consumption <> 0
        GROUP BY 1
      ) u
      GROUP BY u.method
      ORDER BY SUM(u.amount) - SUM(u.refunded) DESC, 1 ASC
    `);
  }

  findWaiterBreakdown(filter: BillFilter): Promise<StaffBreakdownRecord[]> {
    return this.prisma.$queryRaw<StaffBreakdownRecord[]>(Prisma.sql`
      SELECT
        u.staff_id,
        FALSE AS online,
        NULLIF(TRIM(CONCAT(su.first_name, ' ', su.last_name)), '') AS name,
        SUM(u.bills)::int AS bills,
        SUM(u.guests)::int AS guests,
        SUM(u.amount) AS amount,
        SUM(u.tip) AS tip,
        SUM(u.refunded) AS refunded
      FROM (
        SELECT
          w.waiter_id::text AS staff_id,
          COUNT(*)::int AS bills,
          COALESCE(SUM(w.guest_count), 0)::int AS guests,
          COALESCE(SUM(w.total), 0) AS amount,
          COALESCE(SUM(w.tip), 0) AS tip,
          0::numeric AS refunded
        FROM (${waiterBillsSql(filter)}) w
        GROUP BY w.waiter_id
        UNION ALL
        SELECT
          x.waiter_id,
          0,
          0,
          0::numeric,
          0::numeric,
          COALESCE(SUM(x.consumption), 0)
        FROM (${periodRefundsSql(filter)}) x
        WHERE x.consumption <> 0
        GROUP BY x.waiter_id
      ) u
      LEFT JOIN staff_users su ON su.id::text = u.staff_id
      GROUP BY u.staff_id, su.first_name, su.last_name
      ORDER BY SUM(u.amount) - SUM(u.refunded) DESC, 1 ASC
    `);
  }

  findCashierBreakdown(filter: BillFilter): Promise<StaffBreakdownRecord[]> {
    return this.prisma.$queryRaw<StaffBreakdownRecord[]>(Prisma.sql`
      SELECT
        u.staff_id,
        u.online,
        NULLIF(TRIM(CONCAT(su.first_name, ' ', su.last_name)), '') AS name,
        SUM(u.bills)::int AS bills,
        SUM(u.guests)::int AS guests,
        SUM(u.amount) AS amount,
        SUM(u.tip) AS tip,
        SUM(u.refunded) AS refunded
      FROM (
        SELECT
          per.staff_id::text AS staff_id,
          per.online,
          COUNT(*)::int AS bills,
          COALESCE(SUM(per.guest_count), 0)::int AS guests,
          COALESCE(SUM(per.amount), 0) AS amount,
          COALESCE(SUM(per.tip), 0) AS tip,
          0::numeric AS refunded
        FROM (
          SELECT
            e.id,
            e.guest_count,
            p.staff_user_id AS staff_id,
            (p.staff_user_id IS NULL AND p.source = 'WEB_QR') AS online,
            SUM(p.amount - p.tip_amount) AS amount,
            SUM(p.tip_amount) AS tip
          FROM (${eligibleBillsSql(filter)}) e
          JOIN payments p ON p.bill_id = e.id AND ${paidPaymentConditionSql(filter)}
          GROUP BY e.id, e.guest_count, p.staff_user_id, (p.staff_user_id IS NULL AND p.source = 'WEB_QR')
        ) per
        GROUP BY per.staff_id, per.online
        UNION ALL
        SELECT
          x.cashier_id,
          x.online,
          0,
          0,
          0::numeric,
          0::numeric,
          COALESCE(SUM(x.consumption), 0)
        FROM (${periodRefundsSql(filter)}) x
        WHERE x.consumption <> 0
        GROUP BY x.cashier_id, x.online
      ) u
      LEFT JOIN staff_users su ON su.id::text = u.staff_id
      GROUP BY u.staff_id, u.online, su.first_name, su.last_name
      ORDER BY SUM(u.amount) - SUM(u.refunded) DESC, 1 ASC NULLS LAST
    `);
  }

  findHourWeekday(filter: BillFilter): Promise<HourWeekdayRecord[]> {
    return this.prisma.$queryRaw<HourWeekdayRecord[]>(Prisma.sql`
      SELECT
        u.weekday,
        u.hour,
        SUM(u.bills)::int AS bills,
        SUM(u.guests)::int AS guests,
        SUM(u.amount) AS amount,
        SUM(u.tip) AS tip,
        SUM(u.refunded) AS refunded
      FROM (
        SELECT
          EXTRACT(ISODOW FROM x.local_at)::int AS weekday,
          EXTRACT(HOUR FROM x.local_at)::int AS hour,
          COUNT(*)::int AS bills,
          COALESCE(SUM(e.guest_count), 0)::int AS guests,
          COALESCE(SUM(e.total), 0) AS amount,
          COALESCE(SUM(e.tip), 0) AS tip,
          0::numeric AS refunded
        FROM (${eligibleBillsSql(filter)}) e
        CROSS JOIN LATERAL (
          SELECT (e.closed_at AT TIME ZONE ${filter.timeZone}::text) AS local_at
        ) x
        GROUP BY 1, 2
        UNION ALL
        SELECT
          EXTRACT(ISODOW FROM y.local_at)::int,
          EXTRACT(HOUR FROM y.local_at)::int,
          0,
          0,
          0::numeric,
          0::numeric,
          COALESCE(SUM(r.consumption), 0)
        FROM (${periodRefundsSql(filter)}) r
        CROSS JOIN LATERAL (
          SELECT (r.completed_at AT TIME ZONE ${filter.timeZone}::text) AS local_at
        ) y
        GROUP BY 1, 2
      ) u
      GROUP BY 1, 2
      ORDER BY 1, 2
    `);
  }

  findPeriodBuckets(
    filter: BillFilter,
    bucket: 'day' | 'month',
  ): Promise<PeriodBucketRecord[]> {
    const format = bucket === 'day' ? DAY_FORMAT : MONTH_FORMAT;

    return this.prisma.$queryRaw<PeriodBucketRecord[]>(Prisma.sql`
      SELECT
        u.bucket,
        SUM(u.bills)::int AS bills,
        SUM(u.guests)::int AS guests,
        SUM(u.amount) AS amount,
        SUM(u.tip) AS tip,
        SUM(u.refunded) AS refunded
      FROM (
        SELECT
          to_char(e.closed_at AT TIME ZONE ${filter.timeZone}::text, ${format}::text) AS bucket,
          COUNT(*)::int AS bills,
          COALESCE(SUM(e.guest_count), 0)::int AS guests,
          COALESCE(SUM(e.total), 0) AS amount,
          COALESCE(SUM(e.tip), 0) AS tip,
          0::numeric AS refunded
        FROM (${eligibleBillsSql(filter)}) e
        GROUP BY 1
        UNION ALL
        SELECT
          to_char(r.completed_at AT TIME ZONE ${filter.timeZone}::text, ${format}::text),
          0,
          0,
          0::numeric,
          0::numeric,
          COALESCE(SUM(r.consumption), 0)
        FROM (${periodRefundsSql(filter)}) r
        GROUP BY 1
      ) u
      GROUP BY u.bucket
      ORDER BY 1
    `);
  }

  findTipsByWaiterDay(filter: BillFilter): Promise<TipDayRecord[]> {
    return this.prisma.$queryRaw<TipDayRecord[]>(Prisma.sql`
      SELECT
        u.staff_id,
        NULLIF(TRIM(CONCAT(su.first_name, ' ', su.last_name)), '') AS name,
        u.day,
        SUM(u.bills)::int AS bills,
        SUM(u.sales) AS sales,
        SUM(u.tip) AS tip,
        SUM(u.returned) AS returned
      FROM (
        SELECT
          w.waiter_id::text AS staff_id,
          ${localDaySql(Prisma.sql`w.closed_at`, filter.timeZone)} AS day,
          COUNT(*)::int AS bills,
          COALESCE(SUM(w.total), 0) AS sales,
          COALESCE(SUM(w.tip), 0) AS tip,
          0::numeric AS returned
        FROM (${waiterBillsSql(filter)}) w
        GROUP BY 1, 2
        UNION ALL
        SELECT
          r.waiter_id,
          ${localDaySql(Prisma.sql`r.completed_at`, filter.timeZone)},
          0,
          0::numeric,
          0::numeric,
          COALESCE(SUM(r.tip), 0)
        FROM (${periodRefundsSql(filter)}) r
        WHERE r.tip > 0
        GROUP BY 1, 2
      ) u
      LEFT JOIN staff_users su ON su.id::text = u.staff_id
      GROUP BY u.staff_id, su.first_name, su.last_name, u.day
      ORDER BY u.day ASC, 1 ASC NULLS LAST
    `);
  }

  findTipPayouts(filter: BillFilter): Promise<TipPayoutRecord[]> {
    return this.prisma.$queryRaw<TipPayoutRecord[]>(Prisma.sql`
      SELECT
        w.waiter_id::text AS staff_id,
        ${localDaySql(Prisma.sql`p.paid_at`, filter.timeZone)} AS paid_day,
        COALESCE(SUM(p.tip_amount) FILTER (WHERE p.method::text IN (${Prisma.join(CARD_TIP_METHODS)})), 0) AS card_tip,
        COALESCE(SUM(p.tip_amount - p.refunded_tip_amount) FILTER (WHERE p.method::text IN (${Prisma.join(CARD_TIP_METHODS)})), 0) AS card_tip_owed,
        COALESCE(SUM(p.tip_amount) FILTER (WHERE p.method::text = 'CASH'), 0) AS cash_tip,
        COALESCE(SUM(p.tip_amount), 0) AS total_tip
      FROM (${waiterBillsSql(filter)}) w
      JOIN payments p ON p.bill_id = w.id AND ${paidPaymentConditionSql(filter)} AND p.tip_amount > 0
      GROUP BY w.waiter_id, 2
      ORDER BY 2 ASC, 1 ASC NULLS LAST
    `);
  }

  findOpenTabs(filter: OpenTabsFilter): Promise<OpenTabRecord[]> {
    const conditions: Prisma.Sql[] = [
      Prisma.sql`ts.branch_id = ${filter.branchId}::uuid`,
    ];

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

    let endedAt = Prisma.sql`ts.closed_at`;
    let cancelledJoin = Prisma.empty;
    let cancelledColumns = Prisma.sql`NULL::int AS cancelled_orders, NULL::numeric AS cancelled_amount`;
    let order = Prisma.sql`ts.opened_at ASC, ts.id ASC`;

    if (filter.kind === 'open') {
      conditions.push(
        Prisma.sql`ts.status::text = 'OPEN'`,
        Prisma.sql`(b.id IS NULL OR b.status::text IN ('OPEN', 'PARTIALLY_PAID'))`,
      );
      endedAt = Prisma.sql`NULL::timestamptz`;
    } else if (filter.kind === 'abandoned') {
      conditions.push(
        Prisma.sql`ts.status::text = 'ABANDONED'`,
        Prisma.sql`ts.closed_at >= ${filter.start}`,
        Prisma.sql`ts.closed_at < ${filter.end}`,
      );
      order = Prisma.sql`ts.closed_at DESC, ts.id ASC`;
    } else {
      endedAt = Prisma.sql`cx.last_at`;
      cancelledColumns = Prisma.sql`cx.cancelled_orders, cx.cancelled_amount`;
      cancelledJoin = Prisma.sql`
        JOIN LATERAL (
          SELECT
            COUNT(*)::int AS cancelled_orders,
            COALESCE(SUM(oi.amount), 0) AS cancelled_amount,
            MAX(o.updated_at) AS last_at
          FROM orders o
          LEFT JOIN LATERAL (
            SELECT SUM(i.price_snapshot * i.quantity) AS amount
            FROM order_items i
            WHERE i.order_id = o.id
          ) oi ON TRUE
          WHERE o.table_session_id = ts.id
            AND o.status::text = 'CANCELLED'
            AND o.updated_at >= ${filter.start}
            AND o.updated_at < ${filter.end}
        ) cx ON cx.cancelled_orders > 0
      `;
      order = Prisma.sql`cx.last_at DESC, ts.id ASC`;
    }

    return this.prisma.$queryRaw<OpenTabRecord[]>(Prisma.sql`
      SELECT
        ts.id::text AS session_id,
        b.id::text AS bill_id,
        ts.ticket_number,
        ts.is_counter,
        ts.customer_label,
        ts.guest_count,
        ts.status::text AS session_status,
        b.status::text AS bill_status,
        t.name AS table_name,
        z.name AS zone_name,
        NULLIF(TRIM(CONCAT(wu.first_name, ' ', wu.last_name)), '') AS waiter_name,
        ts.opened_at,
        ${endedAt} AS ended_at,
        ts.close_reason,
        COALESCE(b.total_amount, 0) AS total,
        COALESCE(b.total_amount - b.remaining_amount, 0) AS paid,
        COALESCE(b.remaining_amount, 0) AS pending,
        ${cancelledColumns}
      FROM table_sessions ts
      JOIN tables t ON t.id = ts.table_id
      LEFT JOIN table_zones z ON z.id = t.zone_id
      LEFT JOIN bills b ON b.table_session_id = ts.id
      LEFT JOIN staff_users wu ON wu.id = ts.assigned_staff_user_id
      ${cancelledJoin}
      WHERE ${Prisma.join(conditions, ' AND ')}
      ORDER BY ${order}
      LIMIT ${filter.limit}
    `);
  }

  async findKpiTotals(filter: BillFilter): Promise<KpiTotalsRecord> {
    const rows = await this.prisma.$queryRaw<KpiTotalsRecord[]>(Prisma.sql`
      SELECT
        COUNT(*)::int AS bills,
        (COUNT(*) FILTER (WHERE NOT t.is_virtual))::int AS table_bills,
        COALESCE(SUM(e.guest_count), 0)::int AS guests,
        COALESCE(SUM(e.total), 0) AS gross,
        COALESCE(SUM(e.tip), 0) AS tip,
        (SELECT COALESCE(SUM(x.consumption), 0) FROM (${periodRefundsSql(filter)}) x) AS refunded
      FROM (${eligibleBillsSql(filter)}) e
      JOIN bills b ON b.id = e.id
      JOIN table_sessions ts ON ts.id = b.table_session_id
      JOIN tables t ON t.id = ts.table_id
    `);

    return rows[0];
  }

  async countPhysicalTables(branchId: string): Promise<number> {
    const rows = await this.prisma.$queryRaw<{ total: number }[]>(Prisma.sql`
      SELECT COUNT(*)::int AS total
      FROM tables
      WHERE branch_id = ${branchId}::uuid AND NOT is_virtual
    `);

    return rows[0]?.total ?? 0;
  }
}

import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import {
  discountBillsSql,
  eligibleBillsSql,
  type BillFilter,
} from './report-sql';

export type DailyZDocumentRangeRecord = {
  first_number: number | null;
  last_number: number | null;
  bills: number;
};

export type DailyZRefundRecord = {
  refunds: number;
  amount: Prisma.Decimal.Value;
  tip: Prisma.Decimal.Value;
  net: Prisma.Decimal.Value;
  vat: Prisma.Decimal.Value;
  pending_credit_notes: number;
};

export type DailyZCashSalesRecord = {
  staff_id: string | null;
  name: string | null;
  amount: Prisma.Decimal.Value;
  tip: Prisma.Decimal.Value;
};

export type DailyZCashMovementRecord = {
  staff_id: string;
  name: string | null;
  type: string;
  amount: Prisma.Decimal.Value;
};

export type DailyZCashSessionRecord = {
  id: string;
  register_label: string;
  status: string;
  staff_id: string;
  name: string | null;
  opened_at: Date;
  closed_at: Date | null;
  forced: boolean;
  opening_float: Prisma.Decimal.Value;
  cash_sales: Prisma.Decimal.Value;
  movements: Prisma.Decimal.Value;
  counted_cash: Prisma.Decimal.Value | null;
  difference: Prisma.Decimal.Value | null;
  closing_note: string | null;
};

export type DailyZDiscountRecord = {
  amount: Prisma.Decimal.Value;
  count: number;
  byReason: Array<{
    reasonCode: string;
    count: number;
    amount: Prisma.Decimal.Value;
  }>;
  byApprover: Array<{
    staffUserId: string | null;
    name: string | null;
    count: number;
    amount: Prisma.Decimal.Value;
  }>;
};

@Injectable()
export class DailyZPrismaRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findDocumentRange(
    filter: BillFilter,
  ): Promise<DailyZDocumentRangeRecord> {
    const rows = await this.prisma.$queryRaw<DailyZDocumentRangeRecord[]>(
      Prisma.sql`
        SELECT
          MIN(e.bill_number)::int AS first_number,
          MAX(e.bill_number)::int AS last_number,
          COUNT(*)::int AS bills
        FROM (${eligibleBillsSql(filter)}) e
      `,
    );

    return rows[0] ?? { first_number: null, last_number: null, bills: 0 };
  }

  async findDiscountTotals(filter: BillFilter): Promise<DailyZDiscountRecord> {
    const totals = await this.prisma.$queryRaw<
      { amount: Prisma.Decimal.Value; count: number }[]
    >(Prisma.sql`
      SELECT
        COALESCE(SUM(e.discount_amount), 0) AS amount,
        COUNT(*) FILTER (WHERE e.discount_amount > 0)::int AS count
      FROM (${discountBillsSql(filter)}) e
    `);
    const byReason = await this.prisma.$queryRaw<
      DailyZDiscountRecord['byReason']
    >(Prisma.sql`
      SELECT d.reason_code::text AS "reasonCode",
             COUNT(*)::int AS count,
             COALESCE(SUM(d.amount), 0) AS amount
      FROM (${discountBillsSql(filter)}) e
      JOIN bill_discounts d ON d.bill_id = e.id AND d.voided_at IS NULL
      WHERE e.discount_amount > 0
      GROUP BY d.reason_code
      ORDER BY 3 DESC
    `);
    const byApprover = await this.prisma.$queryRaw<
      DailyZDiscountRecord['byApprover']
    >(Prisma.sql`
      SELECT d.approved_by_staff_user_id::text AS "staffUserId",
             NULLIF(TRIM(CONCAT(su.first_name, ' ', su.last_name)), '') AS name,
             COUNT(*)::int AS count,
             COALESCE(SUM(d.amount), 0) AS amount
      FROM (${discountBillsSql(filter)}) e
      JOIN bill_discounts d ON d.bill_id = e.id AND d.voided_at IS NULL
      LEFT JOIN staff_users su ON su.id = d.approved_by_staff_user_id
      WHERE e.discount_amount > 0
      GROUP BY d.approved_by_staff_user_id, su.first_name, su.last_name
      ORDER BY 4 DESC
    `);

    return {
      amount: totals[0]?.amount ?? 0,
      count: totals[0]?.count ?? 0,
      byReason,
      byApprover,
    };
  }

  async findRefundTotals(
    branchId: string,
    start: Date,
    end: Date,
  ): Promise<DailyZRefundRecord> {
    const rows = await this.prisma.$queryRaw<DailyZRefundRecord[]>(Prisma.sql`
      SELECT
        COUNT(*)::int AS refunds,
        COALESCE(SUM(r.amount), 0) AS amount,
        COALESCE(SUM(r.tip_amount), 0) AS tip,
        COALESCE(SUM(r.net_amount), 0) AS net,
        COALESCE(SUM(r.vat_amount), 0) AS vat,
        COUNT(*) FILTER (WHERE r.credit_note_status = 'PENDING')::int AS pending_credit_notes
      FROM refunds r
      WHERE r.branch_id = ${branchId}::uuid
        AND r.status = 'SUCCEEDED'
        AND r.completed_at >= ${start}
        AND r.completed_at < ${end}
    `);

    return (
      rows[0] ?? {
        refunds: 0,
        amount: 0,
        tip: 0,
        net: 0,
        vat: 0,
        pending_credit_notes: 0,
      }
    );
  }

  findCashSales(
    branchId: string,
    start: Date,
    end: Date,
    staffUserId: string | null,
  ): Promise<DailyZCashSalesRecord[]> {
    return this.prisma.$queryRaw<DailyZCashSalesRecord[]>(Prisma.sql`
      SELECT
        p.staff_user_id::text AS staff_id,
        NULLIF(TRIM(CONCAT(su.first_name, ' ', su.last_name)), '') AS name,
        COALESCE(SUM(p.amount), 0) AS amount,
        COALESCE(SUM(p.tip_amount), 0) AS tip
      FROM payments p
      JOIN bills b ON b.id = p.bill_id
      LEFT JOIN staff_users su ON su.id = p.staff_user_id
      WHERE b.branch_id = ${branchId}::uuid
        AND p.status = 'PAID'
        AND p.provider = 'MANUAL'
        AND p.method = 'CASH'
        AND p.paid_at >= ${start}
        AND p.paid_at < ${end}
        ${staffUserId ? Prisma.sql`AND p.staff_user_id = ${staffUserId}::uuid` : Prisma.empty}
      GROUP BY p.staff_user_id, su.first_name, su.last_name
    `);
  }

  findCashMovements(
    branchId: string,
    start: Date,
    end: Date,
    staffUserId: string | null,
  ): Promise<DailyZCashMovementRecord[]> {
    return this.prisma.$queryRaw<DailyZCashMovementRecord[]>(Prisma.sql`
      SELECT
        m.staff_user_id::text AS staff_id,
        NULLIF(TRIM(CONCAT(su.first_name, ' ', su.last_name)), '') AS name,
        m.type::text AS type,
        COALESCE(SUM(m.amount), 0) AS amount
      FROM cash_movements m
      LEFT JOIN staff_users su ON su.id = m.staff_user_id
      WHERE m.branch_id = ${branchId}::uuid
        AND m.created_at >= ${start}
        AND m.created_at < ${end}
        ${staffUserId ? Prisma.sql`AND m.staff_user_id = ${staffUserId}::uuid` : Prisma.empty}
      GROUP BY m.staff_user_id, su.first_name, su.last_name, m.type
    `);
  }

  findCashSessions(
    branchId: string,
    start: Date,
    end: Date,
    staffUserId: string | null,
  ): Promise<DailyZCashSessionRecord[]> {
    return this.prisma.$queryRaw<DailyZCashSessionRecord[]>(Prisma.sql`
      SELECT
        cs.id::text AS id,
        cs.register_label,
        cs.status::text AS status,
        cs.cashier_staff_user_id::text AS staff_id,
        NULLIF(TRIM(CONCAT(su.first_name, ' ', su.last_name)), '') AS name,
        cs.opened_at,
        cs.closed_at,
        cs.forced,
        cs.opening_float,
        COALESCE(cs.cash_sales_amount, sales.amount) AS cash_sales,
        COALESCE(cs.movements_amount, moves.amount) AS movements,
        cs.counted_cash,
        cs.difference,
        cs.closing_note
      FROM cash_sessions cs
      LEFT JOIN staff_users su ON su.id = cs.cashier_staff_user_id
      CROSS JOIN LATERAL (
        SELECT COALESCE(SUM(p.amount), 0) AS amount
        FROM payments p
        WHERE p.cash_session_id = cs.id AND p.method = 'CASH' AND p.status = 'PAID'
      ) sales
      CROSS JOIN LATERAL (
        SELECT COALESCE(SUM(m.amount), 0) AS amount
        FROM cash_movements m
        WHERE m.cash_session_id = cs.id
      ) moves
      WHERE cs.branch_id = ${branchId}::uuid
        AND cs.opened_at >= ${start}
        AND cs.opened_at < ${end}
        ${staffUserId ? Prisma.sql`AND cs.cashier_staff_user_id = ${staffUserId}::uuid` : Prisma.empty}
      ORDER BY cs.opened_at
    `);
  }
}

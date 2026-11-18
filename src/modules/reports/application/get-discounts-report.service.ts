import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type { JwtPayload } from '../../auth/interfaces/jwt-payload.interface';
import { money } from './insights-shared';
import {
  ReportScopeService,
  type ReportScopeQuery,
} from './report-scope.service';

export const MAX_DISCOUNT_ROWS = 500;
const HIGH_PERCENT_ALERT = new Prisma.Decimal(80);
const REPEAT_ALERT_COUNT = 5;

export type DiscountsReportQuery = Pick<ReportScopeQuery, 'from' | 'to'> & {
  cashierId?: string;
  reasonCode?: string;
  voided?: string;
};

type DiscountRowRecord = {
  id: string;
  bill_id: string;
  created_at: Date;
  ticket_number: number | null;
  table_name: string;
  bill_item_name: string | null;
  type: string;
  value: Prisma.Decimal.Value;
  amount: Prisma.Decimal.Value;
  reason_code: string;
  reason_text: string;
  applied_by_id: string;
  applied_by_name: string | null;
  approved_by_id: string | null;
  approved_by_name: string | null;
  voided_at: Date | null;
  void_reason: string | null;
  bill_subtotal: Prisma.Decimal.Value;
};

export type DiscountReportRow = {
  id: string;
  billId: string;
  createdAt: string;
  orderNumber: string;
  table: string;
  line: string | null;
  type: string;
  value: string;
  amount: string;
  reasonCode: string;
  reasonText: string;
  appliedById: string;
  appliedBy: string | null;
  approvedBy: string | null;
  voided: boolean;
  voidReason: string | null;
  highPercent: boolean;
};

export type DiscountGroupTotal = {
  key: string;
  label: string;
  count: number;
  amount: string;
  alert: boolean;
};

export type DiscountsReportResponse = {
  branchId: string;
  from: string;
  to: string;
  timeZone: string;
  cashierScoped: boolean;
  truncated: boolean;
  totals: { count: number; amount: string; voidedCount: number };
  byReason: DiscountGroupTotal[];
  byCashier: DiscountGroupTotal[];
  byApprover: DiscountGroupTotal[];
  rows: DiscountReportRow[];
};

type Group = { label: string; count: number; amount: Prisma.Decimal };

function toGroups(
  groups: Map<string, Group>,
  alertAt: number | null,
): DiscountGroupTotal[] {
  return [...groups.entries()]
    .map(([key, group]) => ({
      key,
      label: group.label,
      count: group.count,
      amount: money(group.amount),
      alert: alertAt !== null && group.count >= alertAt,
    }))
    .sort((a, b) => Number(b.amount) - Number(a.amount));
}

function addTo(
  groups: Map<string, Group>,
  key: string,
  label: string,
  amount: Prisma.Decimal,
) {
  const current = groups.get(key) ?? {
    label,
    count: 0,
    amount: new Prisma.Decimal(0),
  };

  groups.set(key, {
    label,
    count: current.count + 1,
    amount: current.amount.add(amount),
  });
}

@Injectable()
export class GetDiscountsReportService {
  constructor(
    private readonly scopeService: ReportScopeService,
    private readonly prisma: PrismaService,
  ) {}

  async execute(
    authUser: JwtPayload,
    branchId: string,
    query: DiscountsReportQuery,
  ): Promise<DiscountsReportResponse> {
    const scope = await this.scopeService.resolve(authUser, branchId, query, {
      forCsv: false,
    });
    const voidedFilter =
      query.voided === 'true'
        ? Prisma.sql`AND d.voided_at IS NOT NULL`
        : query.voided === 'false'
          ? Prisma.sql`AND d.voided_at IS NULL`
          : Prisma.empty;
    const reasonFilter = query.reasonCode
      ? Prisma.sql`AND d.reason_code::text = ${query.reasonCode}`
      : Prisma.empty;
    const cashierFilter = scope.cashierId
      ? Prisma.sql`AND d.applied_by_staff_user_id = ${scope.cashierId}::uuid`
      : Prisma.empty;
    const records = await this.prisma.$queryRaw<DiscountRowRecord[]>(Prisma.sql`
      SELECT
        d.id::text AS id,
        d.bill_id::text AS bill_id,
        d.created_at,
        ts.ticket_number,
        t.name AS table_name,
        bi.description AS bill_item_name,
        d.type::text AS type,
        d.value,
        d.amount,
        d.reason_code::text AS reason_code,
        d.reason_text,
        d.applied_by_staff_user_id::text AS applied_by_id,
        NULLIF(TRIM(CONCAT(ab.first_name, ' ', ab.last_name)), '') AS applied_by_name,
        d.approved_by_staff_user_id::text AS approved_by_id,
        NULLIF(TRIM(CONCAT(ap.first_name, ' ', ap.last_name)), '') AS approved_by_name,
        d.voided_at,
        d.void_reason,
        b.subtotal_amount AS bill_subtotal
      FROM bill_discounts d
      JOIN bills b ON b.id = d.bill_id
      JOIN table_sessions ts ON ts.id = b.table_session_id
      JOIN tables t ON t.id = ts.table_id
      LEFT JOIN bill_items bi ON bi.id = d.bill_item_id
      LEFT JOIN staff_users ab ON ab.id = d.applied_by_staff_user_id
      LEFT JOIN staff_users ap ON ap.id = d.approved_by_staff_user_id
      WHERE d.branch_id = ${branchId}::uuid
        AND d.created_at >= ${scope.start}
        AND d.created_at < ${scope.end}
        ${voidedFilter}
        ${reasonFilter}
        ${cashierFilter}
      ORDER BY d.created_at DESC, d.id DESC
      LIMIT ${MAX_DISCOUNT_ROWS + 1}
    `);
    const truncated = records.length > MAX_DISCOUNT_ROWS;
    const page = truncated ? records.slice(0, MAX_DISCOUNT_ROWS) : records;
    const byReason = new Map<string, Group>();
    const byCashier = new Map<string, Group>();
    const byApprover = new Map<string, Group>();
    let total = new Prisma.Decimal(0);
    let voidedCount = 0;
    const rows = page.map((record): DiscountReportRow => {
      const amount = new Prisma.Decimal(record.amount);
      const voided = record.voided_at !== null;
      const subtotal = new Prisma.Decimal(record.bill_subtotal);
      const highPercent =
        !voided &&
        subtotal.gt(0) &&
        amount.mul(100).div(subtotal).gte(HIGH_PERCENT_ALERT);

      if (voided) {
        voidedCount += 1;
      } else {
        total = total.add(amount);
        addTo(byReason, record.reason_code, record.reason_code, amount);
        addTo(
          byCashier,
          record.applied_by_id,
          record.applied_by_name ?? record.applied_by_id,
          amount,
        );

        if (record.approved_by_id) {
          addTo(
            byApprover,
            record.approved_by_id,
            record.approved_by_name ?? record.approved_by_id,
            amount,
          );
        }
      }

      return {
        id: record.id,
        billId: record.bill_id,
        createdAt: record.created_at.toISOString(),
        orderNumber: record.ticket_number?.toString() ?? '',
        table: record.table_name,
        line: record.bill_item_name,
        type: record.type,
        value: new Prisma.Decimal(record.value).toString(),
        amount: money(amount),
        reasonCode: record.reason_code,
        reasonText: record.reason_text,
        appliedById: record.applied_by_id,
        appliedBy: record.applied_by_name,
        approvedBy: record.approved_by_name,
        voided,
        voidReason: record.void_reason,
        highPercent,
      };
    });
    const activeCount = rows.length - voidedCount;

    return {
      branchId,
      from: scope.from,
      to: scope.to,
      timeZone: scope.timeZone,
      cashierScoped: scope.cashierScoped,
      truncated,
      totals: { count: activeCount, amount: money(total), voidedCount },
      byReason: toGroups(byReason, null),
      byCashier: toGroups(byCashier, REPEAT_ALERT_COUNT),
      byApprover: toGroups(byApprover, null),
      rows,
    };
  }
}

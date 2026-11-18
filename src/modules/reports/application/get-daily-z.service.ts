import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { zonedDateKey } from '../../../common/time/restaurant-time';
import type { JwtPayload } from '../../auth/interfaces/jwt-payload.interface';
import { computeVatBreakdown } from '../../billing/domain/tax-policy';
import {
  DailyZPrismaRepository,
  type DailyZCashMovementRecord,
  type DailyZCashSalesRecord,
  type DailyZDiscountRecord,
  type DailyZDocumentRangeRecord,
  type DailyZRefundRecord,
} from '../infrastructure/daily-z.prisma.repository';
import {
  ReportsInsightsPrismaRepository,
  type MethodBreakdownRecord,
} from '../infrastructure/reports-insights.prisma.repository';
import {
  ReportsPrismaRepository,
  type CollectedBillLineRecord,
  type HierarchyLineRecord,
} from '../infrastructure/reports.prisma.repository';
import { buildCashSessionRows, type CashSessionRow } from './cash-session-rows';
import { normalizePath } from './hierarchy-tree';
import { ZERO, money, percent, toBillFilter } from './insights-shared';
import { ReportScopeService } from './report-scope.service';
import { METHOD_LABELS, type MethodKey } from './report-types';

export type DailyZMethodRow = {
  method: MethodKey;
  label: string;
  count: number;
  amount: string;
  tip: string;
  collected: string;
};

export type DailyZCategoryRow = {
  category: string;
  amount: string;
  quantity: number;
  share: number;
};

export type DailyZCashRow = {
  staffUserId: string | null;
  name: string | null;
  cashSales: string;
  cashIn: string;
  cashOut: string;
  refundOut: string;
  otherMovements: string;
  expectedCash: string;
};

export type DailyZSales = {
  documents: {
    count: number;
    firstNumber: number | null;
    lastNumber: number | null;
  };
  netAmount: string;
  exemptAmount: string;
  vatAmount: string;
  total: string;
  tipAmount: string;
  collected: string;
  discounts: string;
  discountCount: number;
  discountsByReason: Array<{
    reasonCode: string;
    count: number;
    amount: string;
  }>;
  discountsByApprover: Array<{
    staffUserId: string | null;
    name: string | null;
    count: number;
    amount: string;
  }>;
};

export type DailyZRefunds = {
  count: number;
  amount: string;
  tipAmount: string;
  consumption: string;
  netAmount: string;
  vatAmount: string;
  pendingCreditNotes: number;
};

export type DailyZAfterRefunds = {
  netAmount: string;
  exemptAmount: string;
  vatAmount: string;
  tipAmount: string;
};

export type DailyZResponse = {
  branchId: string;
  date: string;
  timeZone: string;
  cashierScoped: boolean;
  sales: DailyZSales | null;
  refunds: DailyZRefunds | null;
  afterRefunds: DailyZAfterRefunds | null;
  byMethod: DailyZMethodRow[];
  byCategory: DailyZCategoryRow[];
  cashClosing: {
    rows: DailyZCashRow[];
    expectedCash: string;
    sessions: CashSessionRow[];
  };
};

const sum = (values: Prisma.Decimal.Value[]) =>
  values.reduce<Prisma.Decimal>(
    (total, value) => total.add(value),
    new Prisma.Decimal(0),
  );

export function buildDailyZSales(
  methods: MethodBreakdownRecord[],
  range: DailyZDocumentRangeRecord,
  discountRecord: DailyZDiscountRecord | null = null,
): DailyZSales {
  const consumption = sum(methods.map((m) => m.amount));
  const tip = sum(methods.map((m) => m.tip));
  const vat = computeVatBreakdown(consumption);

  return {
    documents: {
      count: range.bills,
      firstNumber: range.first_number,
      lastNumber: range.last_number,
    },
    netAmount: money(vat.netAmount),
    exemptAmount: money(vat.exemptAmount),
    vatAmount: money(vat.vatAmount),
    total: money(consumption),
    tipAmount: money(tip),
    collected: money(consumption.add(tip)),
    discounts: money(new Prisma.Decimal(discountRecord?.amount ?? 0)),
    discountCount: discountRecord?.count ?? 0,
    discountsByReason: (discountRecord?.byReason ?? []).map((row) => ({
      ...row,
      amount: money(new Prisma.Decimal(row.amount)),
    })),
    discountsByApprover: (discountRecord?.byApprover ?? []).map((row) => ({
      ...row,
      amount: money(new Prisma.Decimal(row.amount)),
    })),
  };
}

export function buildDailyZRefunds(record: DailyZRefundRecord): DailyZRefunds {
  const amount = new Prisma.Decimal(record.amount);
  const tip = new Prisma.Decimal(record.tip);

  return {
    count: record.refunds,
    amount: money(amount),
    tipAmount: money(tip),
    consumption: money(amount.sub(tip)),
    netAmount: money(record.net),
    vatAmount: money(record.vat),
    pendingCreditNotes: record.pending_credit_notes,
  };
}

export function buildDailyZAfterRefunds(
  sales: DailyZSales,
  refunds: DailyZRefunds,
): DailyZAfterRefunds {
  return {
    netAmount: money(
      new Prisma.Decimal(sales.netAmount).sub(refunds.netAmount),
    ),
    exemptAmount: sales.exemptAmount,
    vatAmount: money(
      new Prisma.Decimal(sales.vatAmount).sub(refunds.vatAmount),
    ),
    tipAmount: money(
      new Prisma.Decimal(sales.tipAmount).sub(refunds.tipAmount),
    ),
  };
}

export function buildDailyZMethods(
  methods: MethodBreakdownRecord[],
): DailyZMethodRow[] {
  return methods.map((record) => {
    const amount = new Prisma.Decimal(record.amount);
    const tip = new Prisma.Decimal(record.tip);

    return {
      method: record.method as MethodKey,
      label: METHOD_LABELS[record.method as MethodKey] ?? record.method,
      count: record.payments,
      amount: money(amount),
      tip: money(tip),
      collected: money(amount.add(tip)),
    };
  });
}

export function allocateCollectedLines(
  lines: CollectedBillLineRecord[],
): HierarchyLineRecord[] {
  const byBill = new Map<string, CollectedBillLineRecord[]>();

  for (const line of lines) {
    byBill.set(line.bill_id, [...(byBill.get(line.bill_id) ?? []), line]);
  }

  const result: HierarchyLineRecord[] = [];

  for (const billLines of byBill.values()) {
    const collected = new Prisma.Decimal(billLines[0].collected);
    const billTotal = sum(billLines.map((line) => line.amount));

    if (billTotal.lte(0) || collected.lte(0)) {
      continue;
    }

    const shares = billLines.map((line) =>
      new Prisma.Decimal(line.amount)
        .mul(collected)
        .div(billTotal)
        .toDecimalPlaces(0),
    );
    const largest = shares.reduce(
      (best, share, index) => (share.gt(shares[best]) ? index : best),
      0,
    );

    shares[largest] = shares[largest].add(collected.sub(sum(shares)));
    billLines.forEach((line, index) =>
      result.push({
        category_path: line.category_path,
        item_name: line.item_name,
        station_name: line.station_name,
        amount: shares[index],
        quantity: line.quantity,
        cancelled_quantity: 0,
      }),
    );
  }

  return result;
}

export function buildDailyZCategories(
  lines: HierarchyLineRecord[],
): DailyZCategoryRow[] {
  const byCategory = new Map<
    string,
    { amount: Prisma.Decimal; quantity: number }
  >();

  for (const line of lines) {
    const category = normalizePath(line.category_path)[0];
    const current = byCategory.get(category) ?? { amount: ZERO, quantity: 0 };

    byCategory.set(category, {
      amount: current.amount.add(line.amount),
      quantity: current.quantity + line.quantity,
    });
  }

  const total = sum([...byCategory.values()].map((entry) => entry.amount));

  return [...byCategory.entries()]
    .map(([category, entry]) => ({
      category,
      amount: money(entry.amount),
      quantity: entry.quantity,
      share: percent(entry.amount, total),
    }))
    .sort(
      (a, b) =>
        Number(b.amount) - Number(a.amount) ||
        a.category.localeCompare(b.category),
    );
}

type CashAccount = {
  name: string | null;
  cashSales: Prisma.Decimal;
  cashIn: Prisma.Decimal;
  cashOut: Prisma.Decimal;
  refundOut: Prisma.Decimal;
  other: Prisma.Decimal;
};

export function buildDailyZCash(
  sales: DailyZCashSalesRecord[],
  movements: DailyZCashMovementRecord[],
  forcedStaffUserId: string | null = null,
): { rows: DailyZCashRow[]; expectedCash: string } {
  const accounts = new Map<string | null, CashAccount>();
  const account = (id: string | null, name: string | null): CashAccount => {
    const existing = accounts.get(id);

    if (existing) {
      existing.name = existing.name ?? name;
      return existing;
    }

    const created: CashAccount = {
      name,
      cashSales: ZERO,
      cashIn: ZERO,
      cashOut: ZERO,
      refundOut: ZERO,
      other: ZERO,
    };
    accounts.set(id, created);
    return created;
  };

  if (forcedStaffUserId) {
    account(forcedStaffUserId, null);
  }

  for (const record of sales) {
    const entry = account(record.staff_id, record.name);
    entry.cashSales = entry.cashSales.add(record.amount);
  }

  for (const record of movements) {
    const entry = account(record.staff_id, record.name);
    const amount = new Prisma.Decimal(record.amount);

    if (record.type === 'CASH_IN') {
      entry.cashIn = entry.cashIn.add(amount);
    } else if (record.type === 'CASH_OUT') {
      entry.cashOut = entry.cashOut.add(amount);
    } else if (record.type === 'REFUND_OUT') {
      entry.refundOut = entry.refundOut.add(amount);
    } else {
      entry.other = entry.other.add(amount);
    }
  }

  const lines = [...accounts.entries()]
    .map(([staffUserId, entry]) => {
      const expected = sum([
        entry.cashSales,
        entry.cashIn,
        entry.cashOut,
        entry.refundOut,
        entry.other,
      ]);

      return {
        expected,
        row: {
          staffUserId,
          name: entry.name,
          cashSales: money(entry.cashSales),
          cashIn: money(entry.cashIn),
          cashOut: money(entry.cashOut),
          refundOut: money(entry.refundOut),
          otherMovements: money(entry.other),
          expectedCash: money(expected),
        },
      };
    })
    .sort((a, b) => (a.row.name ?? '~').localeCompare(b.row.name ?? '~'));

  return {
    rows: lines.map((line) => line.row),
    expectedCash: money(sum(lines.map((line) => line.expected))),
  };
}

@Injectable()
export class GetDailyZService {
  constructor(
    private readonly scopeService: ReportScopeService,
    private readonly reportsRepository: ReportsPrismaRepository,
    private readonly insightsRepository: ReportsInsightsPrismaRepository,
    private readonly dailyZRepository: DailyZPrismaRepository,
  ) {}

  async execute(
    authUser: JwtPayload,
    branchId: string,
    date: string | undefined,
  ): Promise<DailyZResponse> {
    const day =
      date ??
      zonedDateKey(
        new Date(),
        (await this.scopeService.resolveAccess(authUser, branchId)).timeZone,
      );
    const scope = await this.scopeService.resolve(
      authUser,
      branchId,
      { from: day, to: day },
      { forCsv: false },
    );
    const base = {
      branchId,
      date: scope.from,
      timeZone: scope.timeZone,
      cashierScoped: scope.cashierScoped,
    };
    const staffUserId = scope.cashierScoped ? scope.cashierId : null;
    const [cashSales, movements, sessionRecords] = await Promise.all([
      this.dailyZRepository.findCashSales(
        branchId,
        scope.start,
        scope.end,
        staffUserId,
      ),
      this.dailyZRepository.findCashMovements(
        branchId,
        scope.start,
        scope.end,
        staffUserId,
      ),
      this.dailyZRepository.findCashSessions(
        branchId,
        scope.start,
        scope.end,
        staffUserId,
      ),
    ]);
    const cashClosing = {
      ...buildDailyZCash(cashSales, movements, staffUserId),
      sessions: buildCashSessionRows(sessionRecords),
    };

    if (scope.cashierScoped) {
      return {
        ...base,
        sales: null,
        refunds: null,
        afterRefunds: null,
        byMethod: [],
        byCategory: [],
        cashClosing,
      };
    }

    const filter = { ...toBillFilter(scope), cashierId: null, methods: [] };
    const [methods, range, refundRecord, lines, discountRecord] =
      await Promise.all([
        this.insightsRepository.findMethodBreakdown(filter),
        this.dailyZRepository.findDocumentRange(filter),
        this.dailyZRepository.findRefundTotals(
          branchId,
          scope.start,
          scope.end,
        ),
        this.reportsRepository.findCollectedBillLines({
          ...filter,
          includeModifiers: true,
        }),
        this.dailyZRepository.findDiscountTotals(filter),
      ]);
    const sales = buildDailyZSales(methods, range, discountRecord);
    const refunds = buildDailyZRefunds(refundRecord);

    return {
      ...base,
      sales,
      refunds,
      afterRefunds: buildDailyZAfterRefunds(sales, refunds),
      byMethod: buildDailyZMethods(methods),
      byCategory: buildDailyZCategories(allocateCollectedLines(lines)),
      cashClosing,
    };
  }
}

import { Prisma } from '@prisma/client';
import { LoginProfileType } from '../../auth/dto/login.dto';
import {
  GetDailyZService,
  buildDailyZAfterRefunds,
  buildDailyZCash,
  buildDailyZCategories,
  buildDailyZRefunds,
  buildDailyZSales,
} from './get-daily-z.service';
import { EMPTY_FILTERS, type ReportScope } from './report-types';

const methods = [
  {
    method: 'CASH',
    payments: 2,
    bills: 2,
    amount: 11900,
    tip: 1000,
    refunded: 0,
  },
  {
    method: 'CREDIT_CARD',
    payments: 1,
    bills: 1,
    amount: 23800,
    tip: 2380,
    refunded: 0,
  },
];
const range = { first_number: 10, last_number: 12, bills: 3 };

describe('daily Z builders', () => {
  it('splits consumption into net and vat and keeps tips apart', () => {
    const sales = buildDailyZSales(methods, range);

    expect(sales.total).toBe('35700');
    expect(sales.netAmount).toBe('30000');
    expect(sales.vatAmount).toBe('5700');
    expect(sales.exemptAmount).toBe('0');
    expect(sales.tipAmount).toBe('3380');
    expect(sales.documents).toEqual({
      count: 3,
      firstNumber: 10,
      lastNumber: 12,
    });
  });

  it('satisfies net + exempt + vat + tips = collected', () => {
    const sales = buildDailyZSales(methods, range);
    const rebuilt = new Prisma.Decimal(sales.netAmount)
      .add(sales.exemptAmount)
      .add(sales.vatAmount)
      .add(sales.tipAmount);

    expect(rebuilt.toString()).toBe(sales.collected);
    expect(sales.collected).toBe('39080');
  });

  it('subtracts credit note net, vat and tip after refunds', () => {
    const sales = buildDailyZSales(methods, range);
    const refunds = buildDailyZRefunds({
      refunds: 1,
      amount: 5950,
      tip: 0,
      net: 5000,
      vat: 950,
      pending_credit_notes: 1,
    });
    const after = buildDailyZAfterRefunds(sales, refunds);

    expect(after.netAmount).toBe('25000');
    expect(after.vatAmount).toBe('4750');
    expect(refunds.pendingCreditNotes).toBe(1);
  });

  it('groups categories by their top level', () => {
    const rows = buildDailyZCategories([
      {
        category_path: ['Cafe', 'Calientes'],
        item_name: 'a',
        station_name: 's',
        amount: 3000,
        quantity: 2,
        cancelled_quantity: 0,
      },
      {
        category_path: ['Cafe', 'Frios'],
        item_name: 'b',
        station_name: 's',
        amount: 1000,
        quantity: 1,
        cancelled_quantity: 0,
      },
      {
        category_path: null,
        item_name: 'c',
        station_name: 's',
        amount: 1000,
        quantity: 1,
        cancelled_quantity: 0,
      },
    ]);

    expect(rows[0]).toMatchObject({
      category: 'Cafe',
      amount: '4000',
      quantity: 3,
      share: 80,
    });
    expect(rows).toHaveLength(2);
  });

  it('computes expected cash per cashier with signed movements', () => {
    const cash = buildDailyZCash(
      [{ staff_id: 's1', name: 'Ana', amount: 20000, tip: 1000 }],
      [
        { staff_id: 's1', name: 'Ana', type: 'CASH_IN', amount: 5000 },
        { staff_id: 's1', name: 'Ana', type: 'CASH_OUT', amount: -2000 },
        { staff_id: 's1', name: 'Ana', type: 'REFUND_OUT', amount: -3000 },
        { staff_id: 's2', name: 'Beto', type: 'CASH_IN', amount: 1000 },
      ],
    );

    expect(cash.rows[0]).toMatchObject({ name: 'Ana', expectedCash: '20000' });
    expect(cash.rows[1]).toMatchObject({ name: 'Beto', expectedCash: '1000' });
    expect(cash.expectedCash).toBe('21000');
  });

  it('always returns a row for the scoped cashier', () => {
    const cash = buildDailyZCash([], [], 's9');

    expect(cash.rows).toHaveLength(1);
    expect(cash.rows[0].expectedCash).toBe('0');
  });
});

describe('GetDailyZService', () => {
  const baseScope: ReportScope = {
    branchId: 'b1',
    timeZone: 'America/Santiago',
    from: '2026-11-17',
    to: '2026-11-17',
    start: new Date('2026-11-17T03:00:00.000Z'),
    end: new Date('2026-11-18T03:00:00.000Z'),
    cashierId: null,
    methods: [],
    cashierScoped: false,
    filters: EMPTY_FILTERS,
  };
  const authUser = {
    sub: 'a',
    profileType: LoginProfileType.STAFF,
    profileId: 's',
    restaurantId: 'r',
  };

  function build(scope: ReportScope) {
    const scopeService = {
      resolve: jest.fn().mockResolvedValue(scope),
      resolveAccess: jest.fn().mockResolvedValue({ timeZone: scope.timeZone }),
    };
    const dailyZ = {
      findDocumentRange: jest.fn().mockResolvedValue(range),
      findRefundTotals: jest.fn().mockResolvedValue({
        refunds: 0,
        amount: 0,
        tip: 0,
        net: 0,
        vat: 0,
        pending_credit_notes: 0,
      }),
      findCashSales: jest.fn().mockResolvedValue([]),
      findCashMovements: jest.fn().mockResolvedValue([]),
    };
    const insights = {
      findMethodBreakdown: jest.fn().mockResolvedValue(methods),
    };
    const reports = { findHierarchyLines: jest.fn().mockResolvedValue([]) };
    const service = new GetDailyZService(
      scopeService as never,
      reports as never,
      insights as never,
      dailyZ as never,
    );

    return { service, dailyZ, insights, scopeService };
  }

  it('returns the full report for managers', async () => {
    const { service, dailyZ } = build(baseScope);
    const result = await service.execute(authUser, 'b1', '2026-11-17');

    expect(result.sales?.collected).toBe('39080');
    expect(dailyZ.findCashSales).toHaveBeenCalledWith(
      'b1',
      baseScope.start,
      baseScope.end,
      null,
    );
  });

  it('defaults a missing date to today in the branch timezone', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-11-18T01:30:00Z'));
    const { service, scopeService } = build(baseScope);

    await service.execute(authUser, 'b1', undefined);
    jest.useRealTimers();

    expect(scopeService.resolve).toHaveBeenCalledWith(
      authUser,
      'b1',
      { from: '2026-11-17', to: '2026-11-17' },
      { forCsv: false },
    );
  });

  it('limits a cashier to their own cash closing', async () => {
    const { service, dailyZ, insights } = build({
      ...baseScope,
      cashierScoped: true,
      cashierId: 's9',
    });
    const result = await service.execute(authUser, 'b1', undefined);

    expect(result.sales).toBeNull();
    expect(result.cashClosing.rows[0].staffUserId).toBe('s9');
    expect(insights.findMethodBreakdown).not.toHaveBeenCalled();
    expect(dailyZ.findCashSales).toHaveBeenCalledWith(
      'b1',
      baseScope.start,
      baseScope.end,
      's9',
    );
  });
});

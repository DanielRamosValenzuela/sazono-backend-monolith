import { Prisma } from '@prisma/client';
import { LoginProfileType } from '../../auth/dto/login.dto';
import type {
  BillPageRecord,
  BillPaymentRecord,
  BillRowRecord,
  MethodTotalRecord,
  ReportsPrismaRepository,
} from '../infrastructure/reports.prisma.repository';
import {
  GetSalesByOrderService,
  buildSalesByOrderRow,
  buildSalesByOrderTotals,
} from './get-sales-by-order.service';
import type { ReportScopeService } from './report-scope.service';
import { EMPTY_FILTERS, type ReportScope } from './report-types';

const BOM = String.fromCharCode(0xfeff);

const authUser = {
  sub: 'auth-1',
  profileType: LoginProfileType.STAFF,
  profileId: 'staff-1',
  restaurantId: 'restaurant-1',
};

const scope: ReportScope = {
  branchId: 'branch-1',
  timeZone: 'America/Santiago',
  from: '2026-07-14',
  to: '2026-07-15',
  start: new Date('2026-07-14T04:00:00.000Z'),
  end: new Date('2026-07-16T04:00:00.000Z'),
  cashierId: null,
  methods: [],
  cashierScoped: false,
  filters: EMPTY_FILTERS,
};

const BILL_A = '11111111-1111-4111-8111-111111111111';
const PRODUCT = '44444444-4444-4444-8444-444444444444';

function bill(id: string, closedAt: string): BillRowRecord {
  return {
    id,
    closed_at: new Date(closedAt),
    ticket_number: null,
    guest_count: 2,
    table_name: 'Mesa 1',
    zone_name: 'Terraza',
    waiter_name: 'Ana Mesera',
  };
}

function payment(
  id: string,
  amount: number,
  tip: number,
  method: string | null,
  extra: Partial<BillPaymentRecord> = {},
): BillPaymentRecord {
  return {
    id,
    bill_id: BILL_A,
    amount,
    tip_amount: tip,
    method,
    source: 'CASHIER',
    staff_name: 'Caro Cajera',
    ...extra,
  };
}

function page(payments: BillPaymentRecord[]): BillPageRecord {
  const total = payments.reduce(
    (sum, entry) =>
      sum.add(new Prisma.Decimal(entry.amount).sub(entry.tip_amount)),
    new Prisma.Decimal(0),
  );
  const tip = payments.reduce(
    (sum, entry) => sum.add(entry.tip_amount),
    new Prisma.Decimal(0),
  );

  return {
    ...bill(BILL_A, '2026-07-15T15:00:00.000Z'),
    bill_total: total,
    bill_tip: tip,
    order_key: 'ABC123',
    payments,
  };
}

const sumMethods = (entries: { amount: string }[]) =>
  entries
    .reduce((sum, entry) => sum.add(entry.amount), new Prisma.Decimal(0))
    .toString();

describe('buildSalesByOrderRow with refunds', () => {
  it('subtracts the refunded consumption per payment and keeps gross total and tip', () => {
    const row = buildSalesByOrderRow(bill(BILL_A, '2026-07-15T15:00:00.000Z'), [
      payment('p1', 11000, 1000, 'CASH', {
        refunded: '3000',
        refunded_tip: '273',
      }),
      payment('p2', 5000, 0, 'CREDIT_CARD', {
        refunded: '0',
        refunded_tip: '0',
      }),
    ]);

    expect(row).toMatchObject({
      total: '15000',
      payable: '15000',
      tip: '1000',
      refunded: '3000',
      tipRefunded: '273',
      net: '12000',
      refundStatus: 'PARTIAL',
    });
    expect(row.methods.find((entry) => entry.method === 'CASH')?.amount).toBe(
      '7000',
    );
    expect(sumMethods(row.methods)).toBe(row.net);
  });

  it.each([
    ['NONE', '0', '0'],
    ['PARTIAL', '4000', '0'],
    ['FULL', '10000', '0'],
    ['PARTIAL', '0', '500'],
  ])('derives refundStatus %s', (status, refunded, tipRefunded) => {
    const row = buildSalesByOrderRow(bill(BILL_A, '2026-07-15T15:00:00.000Z'), [
      payment('p1', 10000, 0, 'CASH', {
        refunded,
        refunded_tip: tipRefunded,
      }),
    ]);

    expect(row.refundStatus).toBe(status);
  });

  it('is unchanged when nothing is refunded', () => {
    const plain = buildSalesByOrderRow(
      bill(BILL_A, '2026-07-15T15:00:00.000Z'),
      [payment('p1', 11000, 1000, 'CASH')],
    );

    expect(plain).toMatchObject({
      total: '10000',
      refunded: '0',
      tipRefunded: '0',
      net: '10000',
      refundStatus: 'NONE',
    });
    expect(sumMethods(plain.methods)).toBe(plain.total);
  });
});

describe('buildSalesByOrderTotals with refunds', () => {
  const methodTotals = [
    {
      method: 'CASH',
      payments: 1,
      consumption: 10000,
      tip: 1000,
      refunded: 3000,
      refunded_tip: 0,
      bills: 2,
    },
    {
      method: 'CREDIT_CARD',
      payments: 1,
      consumption: 5000,
      tip: 0,
      refunded: 0,
      refunded_tip: 0,
      bills: 2,
    },
  ] satisfies MethodTotalRecord[];

  it('keeps net = total - refunded = sum of methods with other period refunds subtracted', () => {
    const totals = buildSalesByOrderTotals(2, methodTotals, [
      { method: 'CASH', refunds: 1, consumption: 3000, tip: 0 },
      { method: 'MERCADO_PAGO', refunds: 1, consumption: 2000, tip: 0 },
    ]);

    expect(totals).toMatchObject({
      total: '15000',
      refunded: '5000',
      net: '10000',
      tipRefunded: '0',
    });
    expect(sumMethods(totals.methods)).toBe(totals.net);
    expect(
      totals.methods.find((entry) => entry.method === 'MERCADO_PAGO')?.amount,
    ).toBe('-2000');
    expect(totals.otherPeriod).toMatchObject({
      included: true,
      refunded: '2000',
      tipRefunded: '0',
    });
    expect(
      totals.otherPeriod.methods.find(
        (entry) => entry.method === 'MERCADO_PAGO',
      )?.amount,
    ).toBe('2000');
  });

  it('counts the tip of other periods only for refunds without a row', () => {
    const totals = buildSalesByOrderTotals(
      2,
      [{ ...methodTotals[0], refunded_tip: 100 }, methodTotals[1]],
      [{ method: 'CASH', refunds: 2, consumption: 3500, tip: 400 }],
    );

    expect(totals.tipRefunded).toBe('400');
    expect(totals.otherPeriod).toMatchObject({
      refunded: '500',
      tipRefunded: '300',
    });
  });

  it('marks other period as not included when it cannot be computed', () => {
    const totals = buildSalesByOrderTotals(2, methodTotals);

    expect(totals.otherPeriod.included).toBe(false);
    expect(totals.otherPeriod.refunded).toBe('0');
    expect(totals.refunded).toBe('3000');
    expect(sumMethods(totals.methods)).toBe(totals.net);
  });

  it('matches the old totals when nothing is refunded', () => {
    const totals = buildSalesByOrderTotals(
      3,
      [
        {
          method: 'CASH',
          payments: 4,
          consumption: '10000.00',
          tip: '1000.00',
        },
        { method: 'DEBIT_CARD', payments: 1, consumption: 5000, tip: 0 },
      ],
      [],
    );

    expect(totals).toMatchObject({
      total: '15000',
      refunded: '0',
      net: '15000',
      tipRefunded: '0',
    });
    expect(sumMethods(totals.methods)).toBe(totals.total);
  });
});

describe('GetSalesByOrderService with refunds', () => {
  const resolveMock = jest.fn();
  const findBillPageMock = jest.fn();
  const findMethodTotalsMock = jest.fn();
  const findRefundsByMethodMock = jest.fn();
  const findDiscountOnlyTotalMock = jest.fn();
  const service = new GetSalesByOrderService(
    { resolve: resolveMock } as unknown as ReportScopeService,
    {
      findBillPage: findBillPageMock,
      findMethodTotals: findMethodTotalsMock,
      findRefundsByMethod: findRefundsByMethodMock,
      findDiscountOnlyTotal: findDiscountOnlyTotalMock,
    } as unknown as ReportsPrismaRepository,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    resolveMock.mockResolvedValue(scope);
    findBillPageMock.mockResolvedValue([
      page([
        payment('p1', 11000, 1000, 'CASH', {
          refunded: '3000',
          refunded_tip: '0',
        }),
      ]),
    ]);
    findMethodTotalsMock.mockResolvedValue([
      {
        method: 'CASH',
        payments: 1,
        consumption: 10000,
        tip: 1000,
        refunded: 3000,
        refunded_tip: 0,
        bills: 1,
      },
    ]);
    findRefundsByMethodMock.mockResolvedValue([
      { method: 'CASH', refunds: 1, consumption: 3000, tip: 0 },
      { method: 'MERCADO_PAGO', refunds: 1, consumption: 2000, tip: 0 },
    ]);
  });

  it('satisfies the invariants between rows, other period and totals', async () => {
    const response = await service.execute(authUser, 'branch-1', {});
    const rowsRefunded = response.rows.reduce(
      (sum, row) => sum + Number(row.refunded),
      0,
    );
    const rowsNet = response.rows.reduce(
      (sum, row) => sum + Number(row.net),
      0,
    );
    const rowsMethods = response.rows.reduce(
      (sum, row) =>
        sum +
        row.methods.reduce((inner, entry) => inner + Number(entry.amount), 0),
      0,
    );

    expect(rowsMethods).toBe(rowsNet);
    expect(rowsRefunded + Number(response.totals.otherPeriod.refunded)).toBe(
      Number(response.totals.refunded),
    );
    expect(Number(response.totals.net)).toBe(
      Number(response.totals.total) - Number(response.totals.refunded),
    );
    expect(
      response.totals.methods.reduce(
        (sum, entry) => sum + Number(entry.amount),
        0,
      ),
    ).toBe(Number(response.totals.net));
    expect(response.totals.otherPeriod.included).toBe(true);
  });

  it.each([
    { timeFromMinute: 600 },
    { timeToMinute: 600 },
    { weekdays: [1] },
    { billStatuses: ['MIXED'] },
    { minAmount: 1000 },
    { maxAmount: 1000 },
    { hasTip: true },
    { minTip: 100 },
    { q: 'mesa' },
    { productId: PRODUCT },
    { productName: 'Latte' },
    { categoryPath: ['Cafe'] },
  ])(
    'does not include other period when a closing filter is active: %j',
    async (filters) => {
      resolveMock.mockResolvedValue({
        ...scope,
        filters: { ...EMPTY_FILTERS, ...filters },
      });

      const response = await service.execute(authUser, 'branch-1', {});

      expect(findRefundsByMethodMock).not.toHaveBeenCalled();
      expect(response.totals.otherPeriod).toMatchObject({
        included: false,
        refunded: '0',
      });
      expect(response.totals.refunded).toBe('3000');
    },
  );

  it('still includes other period with waiter, cashier, method and source filters', async () => {
    resolveMock.mockResolvedValue({
      ...scope,
      cashierId: 'staff-1',
      methods: ['CASH'],
      filters: { ...EMPTY_FILTERS, waiterId: PRODUCT, sources: ['CASHIER'] },
    });

    await service.execute(authUser, 'branch-1', {});

    expect(findRefundsByMethodMock).toHaveBeenCalledWith(
      expect.objectContaining({
        cashierId: 'staff-1',
        methods: ['CASH'],
        waiterId: PRODUCT,
        sources: ['CASHIER'],
        branchId: 'branch-1',
      }),
    );
  });

  it('adds the refund columns and the other periods row to the CSV', async () => {
    const download = await service.executeCsv(authUser, 'branch-1', {});
    const chunks: string[] = [];

    for await (const chunk of download.stream) {
      chunks.push(String(chunk));
    }

    const lines = chunks
      .join('')
      .split('\r\n')
      .filter((line) => line.length > 0);
    const header = lines[0].replace(BOM, '').split(';');

    expect(header.slice(16, 19)).toEqual([
      'Reembolsado',
      'Propina reembolsada',
      'Neto',
    ]);
    expect(lines[1].split(';').slice(16, 19)).toEqual(['3000', '0', '7000']);

    const other = lines[lines.length - 2].split(';');

    expect(other[0]).toBe('REEMBOLSOS DE OTROS PERIODOS');
    expect(other[16]).toBe('2000');
    expect(other[18]).toBe('-2000');
    expect(lines[lines.length - 1].startsWith('TOTAL;1;')).toBe(true);
    expect(new Set(lines.map((line) => line.split(';').length)).size).toBe(1);
  });

  it('omits the other periods row when there is nothing to show', async () => {
    findRefundsByMethodMock.mockResolvedValue([
      { method: 'CASH', refunds: 1, consumption: 3000, tip: 0 },
    ]);

    const download = await service.executeCsv(authUser, 'branch-1', {});
    const chunks: string[] = [];

    for await (const chunk of download.stream) {
      chunks.push(String(chunk));
    }

    expect(chunks.join('')).not.toContain('REEMBOLSOS DE OTROS PERIODOS');
  });
});

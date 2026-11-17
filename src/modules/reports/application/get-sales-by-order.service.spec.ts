import { Prisma } from '@prisma/client';
import { LoginProfileType } from '../../auth/dto/login.dto';
import type {
  BillPaymentRecord,
  BillRowRecord,
  MethodTotalRecord,
  ReportsPrismaRepository,
} from '../infrastructure/reports.prisma.repository';
import {
  GetSalesByOrderService,
  SALES_BY_ORDER_CSV_HEADERS,
  buildSalesByOrderRow,
  buildSalesByOrderTotals,
} from './get-sales-by-order.service';
import { decodeCursor } from './report-cursor';
import type { ReportScopeService } from './report-scope.service';
import type { ReportScope } from './report-types';

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
};

const BILL_A = '11111111-1111-4111-8111-111111111111';
const BILL_B = '22222222-2222-4222-8222-222222222222';
const BILL_C = '33333333-3333-4333-8333-333333333333';

function bill(
  id: string,
  closedAt: string,
  extra: Partial<BillRowRecord> = {},
) {
  return {
    id,
    closed_at: new Date(closedAt),
    ticket_number: null,
    guest_count: 2,
    table_name: 'Mesa 1',
    zone_name: 'Terraza',
    waiter_name: 'Ana Mesera',
    ...extra,
  } satisfies BillRowRecord;
}

function payment(
  id: string,
  billId: string,
  amount: number,
  tip: number,
  method: string | null,
  extra: Partial<BillPaymentRecord> = {},
): BillPaymentRecord {
  return {
    id,
    bill_id: billId,
    amount,
    tip_amount: tip,
    method,
    source: 'CASHIER',
    staff_name: 'Caro Cajera',
    ...extra,
  };
}

describe('buildSalesByOrderRow', () => {
  it('pivots a split bill by method and keeps the tip out of every method column', () => {
    const row = buildSalesByOrderRow(bill(BILL_A, '2026-07-16T03:30:00.000Z'), [
      payment('p1', BILL_A, 11000, 1000, 'CASH'),
      payment('p2', BILL_A, 5000, 0, 'CREDIT_CARD'),
      payment('p3', BILL_A, 3000, 0, null),
    ]);
    const byMethod = Object.fromEntries(
      row.methods.map((entry) => [entry.method, entry.amount]),
    );

    expect(byMethod).toEqual({
      CASH: '10000',
      CREDIT_CARD: '5000',
      DEBIT_CARD: '0',
      TRANSFER: '0',
      MERCADO_PAGO: '0',
      VOUCHER: '0',
      MACH: '0',
      OTHER: '0',
      SIN_CLASIFICAR: '3000',
    });
    expect(row.total).toBe('18000');
    expect(row.payable).toBe('18000');
    expect(row.tip).toBe('1000');
    expect(row.paymentsCount).toBe(3);
    expect(row.paymentStatus).toBe('Mixto');
    expect(row.methods.map((entry) => entry.method)).toEqual([
      'CASH',
      'CREDIT_CARD',
      'DEBIT_CARD',
      'TRANSFER',
      'MERCADO_PAGO',
      'VOUCHER',
      'MACH',
      'OTHER',
      'SIN_CLASIFICAR',
    ]);
  });

  it('sum of the method columns always equals the row total', () => {
    const row = buildSalesByOrderRow(bill(BILL_A, '2026-07-15T15:00:00.000Z'), [
      payment('p1', BILL_A, 7700, 700, 'MERCADO_PAGO'),
      payment('p2', BILL_A, 2300, 0, 'VOUCHER'),
    ]);
    const methodsSum = row.methods.reduce(
      (sum, entry) => sum.add(entry.amount),
      new Prisma.Decimal(0),
    );

    expect(methodsSum.toFixed(0)).toBe(row.total);
  });

  it('labels the caja with the cashier name, QR/Online for web QR payments and Sin asignar for legacy rows', () => {
    const cashier = buildSalesByOrderRow(
      bill(BILL_A, '2026-07-15T15:00:00.000Z'),
      [payment('p1', BILL_A, 1000, 0, 'CASH')],
    );
    const online = buildSalesByOrderRow(
      bill(BILL_B, '2026-07-15T15:00:00.000Z'),
      [
        payment('p2', BILL_B, 1000, 0, 'MERCADO_PAGO', {
          staff_name: null,
          source: 'WEB_QR',
        }),
      ],
    );
    const legacy = buildSalesByOrderRow(
      bill(BILL_C, '2026-07-15T15:00:00.000Z'),
      [
        payment('p3', BILL_C, 1000, 0, null, {
          staff_name: null,
          source: null,
        }),
      ],
    );

    expect(cashier.caja).toBe('Caro Cajera');
    expect(cashier.cashier).toBe('Caro Cajera');
    expect(online.caja).toBe('QR/Online');
    expect(online.cashier).toBeNull();
    expect(legacy.caja).toBe('Sin asignar');
    expect(
      legacy.methods.find((m) => m.method === 'SIN_CLASIFICAR')?.amount,
    ).toBe('1000');
  });

  it('marks two cash payments as a single-method bill and falls back to the last 6 chars of the id as comanda', () => {
    const row = buildSalesByOrderRow(bill(BILL_A, '2026-07-15T15:00:00.000Z'), [
      payment('p1', BILL_A, 500, 0, 'CASH'),
      payment('p2', BILL_A, 500, 0, 'CASH'),
    ]);

    expect(row.paymentStatus).toBe('Pagado');
    expect(row.orderNumber).toBe('111111');
  });

  it('uses the counter ticket number as comanda when present', () => {
    const row = buildSalesByOrderRow(
      bill(BILL_A, '2026-07-15T15:00:00.000Z', { ticket_number: 42 }),
      [payment('p1', BILL_A, 500, 0, 'CASH')],
    );

    expect(row.orderNumber).toBe('42');
  });
});

describe('buildSalesByOrderTotals', () => {
  it('adds every method group and keeps tip separate from the sale', () => {
    const totals = buildSalesByOrderTotals(3, [
      { method: 'CASH', payments: 4, consumption: '10000.00', tip: '1000.00' },
      { method: 'DEBIT_CARD', payments: 1, consumption: 5000, tip: 0 },
      { method: 'SIN_CLASIFICAR', payments: 2, consumption: 3000, tip: 0 },
    ] satisfies MethodTotalRecord[]);

    expect(totals).toMatchObject({
      bills: 3,
      paymentsCount: 7,
      total: '18000',
      payable: '18000',
      tip: '1000',
      discounts: '0',
      refunded: '0',
    });
    expect(
      totals.methods.find((entry) => entry.method === 'DEBIT_CARD')?.amount,
    ).toBe('5000');
  });
});

describe('GetSalesByOrderService', () => {
  const resolveMock = jest.fn();
  const findBillPageMock = jest.fn();
  const findPaymentsForBillsMock = jest.fn();
  const countBillsMock = jest.fn();
  const findMethodTotalsMock = jest.fn();
  const service = new GetSalesByOrderService(
    { resolve: resolveMock } as unknown as ReportScopeService,
    {
      findBillPage: findBillPageMock,
      findPaymentsForBills: findPaymentsForBillsMock,
      countBills: countBillsMock,
      findMethodTotals: findMethodTotalsMock,
    } as unknown as ReportsPrismaRepository,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    resolveMock.mockResolvedValue(scope);
    countBillsMock.mockResolvedValue(3);
    findMethodTotalsMock.mockResolvedValue([
      { method: 'CASH', payments: 2, consumption: 12000, tip: 1000 },
      { method: 'CREDIT_CARD', payments: 1, consumption: 5000, tip: 0 },
    ]);
  });

  it('returns rows, whole-filter totals and a keyset cursor when there are more rows', async () => {
    findBillPageMock.mockResolvedValue([
      bill(BILL_A, '2026-07-16T03:30:00.000Z'),
      bill(BILL_B, '2026-07-15T20:00:00.000Z'),
      bill(BILL_C, '2026-07-15T18:00:00.000Z'),
    ]);
    findPaymentsForBillsMock.mockResolvedValue([
      payment('p1', BILL_A, 11000, 1000, 'CASH'),
      payment('p2', BILL_B, 1000, 0, 'CASH'),
      payment('p3', BILL_B, 5000, 0, 'CREDIT_CARD'),
    ]);

    const result = await service.execute(authUser, 'branch-1', {
      from: '2026-07-14',
      to: '2026-07-15',
      limit: 2,
    });

    expect(findBillPageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        branchId: 'branch-1',
        start: scope.start,
        end: scope.end,
      }),
      null,
      3,
    );
    expect(result.rows.map((row) => row.billId)).toEqual([BILL_A, BILL_B]);
    expect(decodeCursor(result.nextCursor ?? undefined)).toEqual({
      at: new Date('2026-07-15T20:00:00.000Z'),
      id: BILL_B,
    });
    expect(result.totals.total).toBe('17000');
    expect(result.totals.tip).toBe('1000');
    expect(result.limit).toBe(2);
    expect(findPaymentsForBillsMock).toHaveBeenCalledWith(
      [BILL_A, BILL_B],
      expect.anything(),
    );
  });

  it('returns no cursor on the last page and caps the limit at 200', async () => {
    findBillPageMock.mockResolvedValue([
      bill(BILL_A, '2026-07-15T18:00:00.000Z'),
    ]);
    findPaymentsForBillsMock.mockResolvedValue([
      payment('p1', BILL_A, 1000, 0, 'CASH'),
    ]);

    const result = await service.execute(authUser, 'branch-1', {
      limit: 9999,
    });

    expect(result.nextCursor).toBeNull();
    expect(result.limit).toBe(200);
    expect(findBillPageMock.mock.calls[0][2]).toBe(201);
  });

  it('passes the decoded cursor to the repository', async () => {
    findBillPageMock.mockResolvedValue([]);
    findPaymentsForBillsMock.mockResolvedValue([]);
    const firstPage = [
      bill(BILL_A, '2026-07-16T03:30:00.000Z'),
      bill(BILL_B, '2026-07-15T20:00:00.000Z'),
    ];
    findBillPageMock.mockResolvedValueOnce(firstPage);

    const first = await service.execute(authUser, 'branch-1', { limit: 1 });
    await service.execute(authUser, 'branch-1', {
      limit: 1,
      cursor: first.nextCursor ?? undefined,
    });

    expect(findBillPageMock.mock.calls[1][1]).toEqual({
      at: new Date('2026-07-16T03:30:00.000Z'),
      id: BILL_A,
    });
  });

  it('keeps the invariant: sum of method columns across rows equals the totals row', async () => {
    const rowsPayments = [
      payment('p1', BILL_A, 11000, 1000, 'CASH'),
      payment('p2', BILL_B, 1000, 0, 'CASH'),
      payment('p3', BILL_B, 4000, 0, 'CREDIT_CARD'),
    ];
    findBillPageMock.mockResolvedValue([
      bill(BILL_A, '2026-07-16T03:30:00.000Z'),
      bill(BILL_B, '2026-07-15T20:00:00.000Z'),
    ]);
    findPaymentsForBillsMock.mockResolvedValue(rowsPayments);
    findMethodTotalsMock.mockResolvedValue([
      { method: 'CASH', payments: 2, consumption: 11000, tip: 1000 },
      { method: 'CREDIT_CARD', payments: 1, consumption: 4000, tip: 0 },
    ]);

    const result = await service.execute(authUser, 'branch-1', {});

    for (const method of ['CASH', 'CREDIT_CARD'] as const) {
      const rowsSum = result.rows.reduce(
        (sum, row) =>
          sum.add(
            row.methods.find((entry) => entry.method === method)?.amount ?? 0,
          ),
        new Prisma.Decimal(0),
      );

      expect(rowsSum.toFixed(0)).toBe(
        result.totals.methods.find((entry) => entry.method === method)?.amount,
      );
    }

    expect(
      result.rows
        .reduce((sum, row) => sum.add(row.total), new Prisma.Decimal(0))
        .toFixed(0),
    ).toBe(result.totals.total);
  });

  it('streams a CSV with BOM, ; separator, Spanish headers, dd-MM-yyyy HH:mm dates and a TOTAL row', async () => {
    findBillPageMock.mockResolvedValueOnce([
      bill(BILL_A, '2026-07-16T03:30:00.000Z', { waiter_name: '=Peligro' }),
    ]);
    findPaymentsForBillsMock.mockResolvedValue([
      payment('p1', BILL_A, 11000, 1000, 'CASH'),
    ]);

    const download = await service.executeCsv(authUser, 'branch-1', {
      from: '2026-07-14',
      to: '2026-07-15',
    });
    const chunks: string[] = [];

    for await (const chunk of download.stream) {
      chunks.push(String(chunk));
    }

    const text = chunks.join('');
    const lines = text.split('\r\n').filter((line) => line.length > 0);

    expect(resolveMock).toHaveBeenCalledWith(
      authUser,
      'branch-1',
      expect.anything(),
      { forCsv: true },
    );
    expect(download.filename).toBe(
      'cierre-ventas_branch-1_2026-07-14_2026-07-15.csv',
    );
    expect(text.startsWith(BOM)).toBe(true);
    expect(lines[0]).toBe(BOM + SALES_BY_ORDER_CSV_HEADERS.join(';'));
    expect(lines[0]).toContain('Fecha cierre;Comanda;Caja');
    expect(lines[0]).toContain('Efectivo;Tarjeta de crédito');
    expect(
      lines[1].startsWith(
        '15-07-2026 23:30;111111;Caro Cajera;Mesa 1;Terraza;',
      ),
    ).toBe(true);
    expect(lines[1]).toContain(";'=Peligro;");
    expect(lines[1]).toContain(';10000;0;10000;1000;1;');
    expect(lines[lines.length - 1].startsWith('TOTAL;3;')).toBe(true);
    expect(lines[0].split(';')).toHaveLength(lines[1].split(';').length);
    expect(lines[0].split(';')).toHaveLength(
      lines[lines.length - 1].split(';').length,
    );
  });
});

import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Role } from '@prisma/client';
import type { BranchAccessService } from '../../../common/branch-access/branch-access.service';
import { LoginProfileType } from '../../auth/dto/login.dto';
import type {
  RefundReportRecord,
  RefundTotalRecord,
  ReportsPrismaRepository,
} from '../infrastructure/reports.prisma.repository';
import {
  GetRefundsReportService,
  REFUNDS_CSV_HEADERS,
  buildRefundsReportRow,
  buildRefundsReportTotals,
} from './get-refunds-report.service';
import { decodeCursor } from './report-cursor';
import { ReportScopeService } from './report-scope.service';
import { EMPTY_FILTERS, type ReportScope } from './report-types';

const BOM = String.fromCharCode(0xfeff);
const ME = '22222222-2222-4222-8222-222222222222';
const OTHER = '33333333-3333-4333-8333-333333333333';
const R1 = '44444444-4444-4444-8444-444444444444';
const R2 = '55555555-5555-4555-8555-555555555555';

const authUser = {
  sub: 'auth-1',
  profileType: LoginProfileType.STAFF,
  profileId: ME,
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

function record(extra: Partial<RefundReportRecord> = {}): RefundReportRecord {
  return {
    id: R1,
    completed_at: new Date('2026-07-16T03:30:00.000Z'),
    amount: '3000.00',
    tip_amount: '0.00',
    net_amount: '2521.00',
    vat_amount: '479.00',
    status: 'SUCCEEDED',
    refund_method: 'CASH_MANUAL',
    reason_code: 'CUSTOMER_COMPLAINT',
    reason_text: '=Plato frio',
    requested_by_staff_user_id: ME,
    requested_by_role: 'CASHIER',
    credit_note_status: 'PENDING',
    credit_note_folio: null,
    bill_id: '66666666-6666-4666-8666-666666666666',
    payment_id: '77777777-7777-4777-8777-777777777777',
    payment_method: 'CASH',
    provider: 'MANUAL',
    order_number: '7',
    table_name: 'Mesa 1',
    cashier_name: 'Caro Cajera',
    requested_by_name: 'Caro Cajera',
    approved_by_name: null,
    bill_has_active_orders: true,
    ...extra,
  };
}

function totalRecord(
  extra: Partial<RefundTotalRecord> = {},
): RefundTotalRecord {
  return {
    method: 'CASH',
    reason_code: 'CUSTOMER_COMPLAINT',
    requested_by_staff_user_id: ME,
    requested_by_name: 'Caro Cajera',
    count: 2,
    amount: '3500.00',
    consumption: '3000.00',
    tip: '500.00',
    net: '2521.00',
    vat: '479.00',
    ...extra,
  };
}

describe('buildRefundsReportRow', () => {
  it('maps money to strings and exposes the credit note and active orders flags', () => {
    const row = buildRefundsReportRow(record());

    expect(row).toEqual({
      items: [],
      refundId: R1,
      completedAt: '2026-07-16T03:30:00.000Z',
      billId: '66666666-6666-4666-8666-666666666666',
      orderNumber: '7',
      table: 'Mesa 1',
      paymentId: '77777777-7777-4777-8777-777777777777',
      paymentMethod: 'CASH',
      provider: 'MANUAL',
      amount: '3000',
      consumption: '3000',
      tip: '0',
      net: '2521',
      vat: '479',
      refundMethod: 'CASH_MANUAL',
      status: 'SUCCEEDED',
      reasonCode: 'CUSTOMER_COMPLAINT',
      reasonText: '=Plato frio',
      requestedById: ME,
      requestedBy: 'Caro Cajera',
      requestedByRole: 'CASHIER',
      approvedBy: null,
      cashier: 'Caro Cajera',
      creditNoteStatus: 'PENDING',
      creditNoteFolio: null,
      billHasActiveOrders: true,
    });
  });

  it('maps the refunded items', () => {
    const row = buildRefundsReportRow(
      record({
        items: [
          {
            bill_item_id: 'bi-1',
            name: 'Pizza',
            quantity: 2,
            amount: '6000.00',
            kitchen_waste: true,
          },
        ],
      }),
    );

    expect(row.items).toEqual([
      {
        billItemId: 'bi-1',
        name: 'Pizza',
        quantity: 2,
        amount: '6000',
        kitchenWaste: true,
      },
    ]);
  });

  it('labels an unclassified payment method', () => {
    expect(
      buildRefundsReportRow(record({ payment_method: null })).paymentMethod,
    ).toBe('SIN_CLASIFICAR');
  });

  it('separates the tip from the consumption', () => {
    const row = buildRefundsReportRow(
      record({ amount: '3500.00', tip_amount: '500.00' }),
    );

    expect(row).toMatchObject({
      amount: '3500',
      consumption: '3000',
      tip: '500',
    });
  });
});

describe('buildRefundsReportTotals', () => {
  it('groups by method, reason and requester', () => {
    const totals = buildRefundsReportTotals([
      totalRecord(),
      totalRecord({
        method: 'MERCADO_PAGO',
        reason_code: 'OTHER',
        requested_by_staff_user_id: OTHER,
        requested_by_name: 'Ada Admin',
        count: 1,
        amount: '2000.00',
        consumption: '2000.00',
        tip: '0.00',
        net: '1681.00',
        vat: '319.00',
      }),
      totalRecord({
        method: null,
        count: 1,
        amount: '500.00',
        consumption: '500.00',
        tip: '0.00',
        net: '420.00',
        vat: '80.00',
      }),
    ]);

    expect(totals).toMatchObject({
      count: 4,
      amount: '6000',
      consumption: '5500',
      tip: '500',
      net: '4622',
      vat: '878',
    });
    expect(totals.byMethod).toEqual([
      { method: 'CASH', count: 2, amount: '3500' },
      { method: 'MERCADO_PAGO', count: 1, amount: '2000' },
      { method: 'SIN_CLASIFICAR', count: 1, amount: '500' },
    ]);
    expect(totals.byReason).toEqual([
      { reasonCode: 'CUSTOMER_COMPLAINT', count: 3, amount: '4000' },
      { reasonCode: 'OTHER', count: 1, amount: '2000' },
    ]);
    expect(totals.byRequester).toEqual([
      { staffUserId: ME, name: 'Caro Cajera', count: 3, amount: '4000' },
      { staffUserId: OTHER, name: 'Ada Admin', count: 1, amount: '2000' },
    ]);
  });

  it('is empty without refunds', () => {
    expect(buildRefundsReportTotals([])).toMatchObject({
      count: 0,
      amount: '0',
      byMethod: [],
      byReason: [],
      byRequester: [],
    });
  });
});

describe('GetRefundsReportService', () => {
  const resolveMock = jest.fn();
  const findRefundsPageMock = jest.fn();
  const findRefundTotalsMock = jest.fn();
  const service = new GetRefundsReportService(
    { resolve: resolveMock } as unknown as ReportScopeService,
    {
      findRefundsPage: findRefundsPageMock,
      findRefundTotals: findRefundTotalsMock,
    } as unknown as ReportsPrismaRepository,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    resolveMock.mockResolvedValue(scope);
    findRefundsPageMock.mockResolvedValue([]);
    findRefundTotalsMock.mockResolvedValue([]);
  });

  it('returns rows, totals and a cursor of the last visible row ordered by completedAt', async () => {
    findRefundsPageMock.mockResolvedValue([
      record({ id: R1 }),
      record({ id: R2, completed_at: new Date('2026-07-15T12:00:00.000Z') }),
    ]);
    findRefundTotalsMock.mockResolvedValue([totalRecord()]);

    const result = await service.execute(authUser, 'branch-1', {
      from: '2026-07-14',
      to: '2026-07-15',
      limit: 1,
    });

    expect(result.rows).toHaveLength(1);
    expect(result.totals.count).toBe(2);
    expect(findRefundsPageMock.mock.calls[0][2]).toBe(2);
    expect(decodeCursor(result.nextCursor ?? undefined, 'timestamp')).toEqual({
      value: '2026-07-16T03:30:00.000Z',
      id: R1,
    });
    expect(result).toMatchObject({
      from: '2026-07-14',
      to: '2026-07-15',
      orderBy: 'completedAt',
      direction: 'desc',
      limit: 1,
    });
  });

  it('builds a numeric cursor when ordering by amount', async () => {
    findRefundsPageMock.mockResolvedValue([
      record({ id: R1, amount: '3000.00' }),
      record({ id: R2, amount: '1000.00' }),
    ]);

    const result = await service.execute(authUser, 'branch-1', {
      orderBy: 'amount',
      direction: 'asc',
      limit: 1,
    });

    expect(decodeCursor(result.nextCursor ?? undefined, 'number')).toEqual({
      value: '3000.00',
      id: R1,
    });
    expect(findRefundsPageMock.mock.calls[0][0]).toMatchObject({
      orderBy: 'amount',
      direction: 'asc',
    });
  });

  it('forwards every refund filter parsed from the query and the scope', async () => {
    resolveMock.mockResolvedValue({
      ...scope,
      cashierId: OTHER,
      methods: ['CASH'],
      filters: {
        ...EMPTY_FILTERS,
        waiterId: OTHER,
        sources: ['CASHIER'],
        minAmount: 1000,
        hasTip: true,
        q: 'plato',
      },
    });

    await service.execute(authUser, 'branch-1', {
      requestedById: R1,
      reasonCode: 'OTHER,WRONG_ORDER',
      refundStatus: 'SUCCEEDED',
      refundMethod: 'CASH_MANUAL,MANUAL_EXTERNAL',
    });

    expect(findRefundsPageMock.mock.calls[0][0]).toMatchObject({
      branchId: 'branch-1',
      start: scope.start,
      end: scope.end,
      timeZone: 'America/Santiago',
      scopedToStaffUserId: null,
      cashierId: OTHER,
      requestedById: R1,
      methods: ['CASH'],
      sources: ['CASHIER'],
      reasonCodes: ['OTHER', 'WRONG_ORDER'],
      refundStatuses: ['SUCCEEDED'],
      refundMethods: ['CASH_MANUAL', 'MANUAL_EXTERNAL'],
      waiterId: OTHER,
      minAmount: 1000,
      hasTip: true,
      q: 'plato',
    });
  });

  it.each([
    [{ reasonCode: 'NOPE' }],
    [{ refundStatus: 'DONE' }],
    [{ refundMethod: 'CARD' }],
  ])('rejects invalid enum values %j with 400', async (query) => {
    await expect(
      service.execute(authUser, 'branch-1', query),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(findRefundsPageMock).not.toHaveBeenCalled();
  });

  it('forces a cashier to the refunds he registered and ignores cashier and requester filters', async () => {
    resolveMock.mockResolvedValue({
      ...scope,
      cashierId: ME,
      cashierScoped: true,
    });

    await service.execute(authUser, 'branch-1', {
      cashierId: OTHER,
      requestedById: OTHER,
    });

    const filter = findRefundsPageMock.mock.calls[0][0] as Record<
      string,
      unknown
    >;

    expect(filter.scopedToStaffUserId).toBe(ME);
    expect(filter.cashierId).toBeNull();
    expect(filter.requestedById).toBeNull();
    expect(findRefundTotalsMock.mock.calls[0][0]).toMatchObject({
      scopedToStaffUserId: ME,
    });
  });

  it('resolves the scope with the standard range rules for JSON and CSV', async () => {
    await service.execute(authUser, 'branch-1', { from: '2026-07-14' });
    await service.executeCsv(authUser, 'branch-1', { from: '2026-07-14' });

    expect(resolveMock.mock.calls[0][3]).toEqual({ forCsv: false });
    expect(resolveMock.mock.calls[1][3]).toEqual({ forCsv: true });
  });

  it('streams a CSV with BOM, semicolons, neutralised formulas, local dates and a TOTAL row', async () => {
    findRefundsPageMock.mockResolvedValueOnce([
      record({ requested_by_name: '=Peligro' }),
    ]);
    findRefundTotalsMock.mockResolvedValue([
      totalRecord({ count: 1, amount: '3000.00', tip: '0.00' }),
    ]);

    const download = await service.executeCsv(authUser, 'branch-1', {
      from: '2026-07-14',
      to: '2026-07-15',
    });
    let text = '';

    for await (const chunk of download.stream) {
      text += String(chunk);
    }

    const lines = text.split('\r\n').filter((line) => line.length > 0);

    expect(download.filename).toBe(
      'reembolsos_branch-1_2026-07-14_2026-07-15.csv',
    );
    expect(lines[0]).toBe(BOM + REFUNDS_CSV_HEADERS.join(';'));
    expect(lines[0]).toBe(
      BOM +
        'Fecha;Comanda;Mesa;Medio de pago;Proveedor;Monto;Consumo;Propina;Neto;IVA;Motivo;Detalle;Registrado por;Rol;Aprobado por;Cajero;Metodo de reembolso;Estado;Nota de credito;Folio nota de credito',
    );
    expect(
      lines[1].startsWith(
        '15-07-2026 23:30;7;Mesa 1;Efectivo;MANUAL;3000;3000;0;2521;479;Reclamo del cliente;',
      ),
    ).toBe(true);
    expect(lines[1]).toContain("'=Plato frio");
    expect(lines[1]).toContain("'=Peligro");
    expect(lines[lines.length - 1].startsWith('TOTAL;1;')).toBe(true);
    expect(new Set(lines.map((line) => line.split(';').length)).size).toBe(1);
  });

  it('reads a refund at 22:30 Santiago on the local day it happened', async () => {
    findRefundsPageMock.mockResolvedValueOnce([
      record({ completed_at: new Date('2026-07-16T02:30:00.000Z') }),
    ]);

    const download = await service.executeCsv(authUser, 'branch-1', {});
    let text = '';

    for await (const chunk of download.stream) {
      text += String(chunk);
    }

    expect(text).toContain('15-07-2026 22:30;');
  });
});

describe('GetRefundsReportService role scope', () => {
  const ensureAccessMock = jest.fn();
  const findBranchTimezoneMock = jest.fn();
  const findRefundsPageMock = jest.fn();
  const findRefundTotalsMock = jest.fn();
  const repository = {
    findBranchTimezone: findBranchTimezoneMock,
    findRefundsPage: findRefundsPageMock,
    findRefundTotals: findRefundTotalsMock,
  } as unknown as ReportsPrismaRepository;
  const service = new GetRefundsReportService(
    new ReportScopeService(
      { ensureAccess: ensureAccessMock } as unknown as BranchAccessService,
      repository,
    ),
    repository,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    findBranchTimezoneMock.mockResolvedValue('America/Santiago');
    findRefundsPageMock.mockResolvedValue([]);
    findRefundTotalsMock.mockResolvedValue([]);
  });

  it.each([[Role.WAITER], [Role.KITCHEN], [Role.BAR]])(
    'rejects %s',
    async (role) => {
      ensureAccessMock.mockRejectedValue(new ForbiddenException());

      await expect(
        service.execute(authUser, 'branch-1', {
          from: '2026-07-14',
          to: '2026-07-15',
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(ensureAccessMock.mock.calls[0][2]).not.toContain(role);
      expect(ensureAccessMock.mock.calls[0][2]).toEqual([
        Role.ADMIN,
        Role.SUPERVISOR,
        Role.CASHIER,
      ]);
    },
  );

  it('forces the cashier to today and to his own refunds whatever the query says', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-16T18:00:00.000Z'));
    ensureAccessMock.mockResolvedValue({
      staffUserId: ME,
      restaurantId: 'restaurant-1',
      branchId: 'branch-1',
      roles: [Role.CASHIER],
    });

    const result = await service.execute(authUser, 'branch-1', {
      from: '2020-01-01',
      to: '2020-02-01',
      cashierId: OTHER,
      requestedById: OTHER,
    });
    const filter = findRefundsPageMock.mock.calls[0][0] as Record<
      string,
      unknown
    >;

    expect(result.from).toBe('2026-07-16');
    expect(result.to).toBe('2026-07-16');
    expect((filter.start as Date).toISOString()).toBe(
      '2026-07-16T04:00:00.000Z',
    );
    expect((filter.end as Date).toISOString()).toBe('2026-07-17T04:00:00.000Z');
    expect(filter.scopedToStaffUserId).toBe(ME);
    expect(filter.requestedById).toBeNull();
    expect(filter.cashierId).toBeNull();
    jest.useRealTimers();
  });

  it('lets an admin filter by any range and requester', async () => {
    ensureAccessMock.mockResolvedValue({
      staffUserId: ME,
      restaurantId: 'restaurant-1',
      branchId: 'branch-1',
      roles: [Role.ADMIN],
    });

    await service.execute(authUser, 'branch-1', {
      from: '2026-07-01',
      to: '2026-07-10',
      requestedById: OTHER,
      cashierId: OTHER,
    });
    const filter = findRefundsPageMock.mock.calls[0][0] as Record<
      string,
      unknown
    >;

    expect(filter.scopedToStaffUserId).toBeNull();
    expect(filter.requestedById).toBe(OTHER);
    expect(filter.cashierId).toBe(OTHER);
  });

  it('requires from and to for full access roles', async () => {
    ensureAccessMock.mockResolvedValue({
      staffUserId: ME,
      restaurantId: 'restaurant-1',
      branchId: 'branch-1',
      roles: [Role.SUPERVISOR],
    });

    await expect(
      service.execute(authUser, 'branch-1', {}),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

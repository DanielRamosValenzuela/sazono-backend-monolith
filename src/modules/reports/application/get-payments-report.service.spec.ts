import { LoginProfileType } from '../../auth/dto/login.dto';
import type {
  PaymentReportRecord,
  PaymentStatusTotalRecord,
  ReportsPrismaRepository,
} from '../infrastructure/reports.prisma.repository';
import {
  GetPaymentsReportService,
  PAYMENTS_CSV_HEADERS,
  buildPaymentsReportRow,
  buildPaymentsReportTotals,
} from './get-payments-report.service';
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

function record(extra: Partial<PaymentReportRecord> = {}): PaymentReportRecord {
  return {
    kind: 'PAYMENT',
    id: '11111111-1111-4111-8111-111111111111',
    created_at: new Date('2026-07-16T03:30:00.000Z'),
    paid_at: new Date('2026-07-16T03:30:00.000Z'),
    event_at: new Date('2026-07-16T03:30:00.000Z'),
    bill_id: '22222222-2222-4222-8222-222222222222',
    order_number: '7',
    table_name: 'Mesa 1',
    method: 'CASH',
    provider: 'MANUAL',
    provider_reference: 'manual-1',
    status: 'PAID',
    provider_status: null,
    provider_status_detail: null,
    failure_reason: null,
    amount: '10000.00',
    tip: '1000.00',
    source: 'CASHIER',
    staff_name: 'Caro Cajera',
    ...extra,
  };
}

describe('buildPaymentsReportRow', () => {
  it('keeps the sale amount and the tip separate and exposes the charged total', () => {
    const row = buildPaymentsReportRow(record());

    expect(row).toMatchObject({
      kind: 'PAYMENT',
      amount: '10000',
      tip: '1000',
      total: '11000',
      method: 'CASH',
      caja: 'Caro Cajera',
      refunded: '0',
    });
  });

  it('shows failed attempts with provider status, failure reason and QR/Online caja', () => {
    const row = buildPaymentsReportRow(
      record({
        kind: 'ATTEMPT',
        method: null,
        provider: 'MERCADO_PAGO',
        status: 'FAILED',
        provider_status: 'rejected',
        provider_status_detail: 'cc_rejected_insufficient_amount',
        failure_reason: 'La tarjeta no tiene saldo suficiente.',
        paid_at: null,
        staff_name: null,
        source: null,
        tip: 0,
      }),
    );

    expect(row).toMatchObject({
      kind: 'ATTEMPT',
      status: 'FAILED',
      providerStatus: 'rejected',
      failureReason: 'La tarjeta no tiene saldo suficiente.',
      caja: 'QR/Online',
      paidAt: null,
    });
  });
});

describe('buildPaymentsReportTotals', () => {
  it('groups by status and by method, counting only paid payments in the method totals', () => {
    const records: PaymentStatusTotalRecord[] = [
      {
        kind: 'PAYMENT',
        status: 'PAID',
        method: 'CASH',
        count: 2,
        consumption: 8000,
        tip: 500,
      },
      {
        kind: 'PAYMENT',
        status: 'PAID',
        method: null,
        count: 1,
        consumption: 2000,
        tip: 0,
      },
      {
        kind: 'PAYMENT',
        status: 'PAID',
        method: 'CREDIT_CARD',
        count: 1,
        consumption: 5000,
        tip: 0,
      },
      {
        kind: 'ATTEMPT',
        status: 'FAILED',
        method: null,
        count: 3,
        consumption: 9000,
        tip: 0,
      },
      {
        kind: 'ATTEMPT',
        status: 'PENDING',
        method: null,
        count: 1,
        consumption: 1000,
        tip: 0,
      },
    ];

    const totals = buildPaymentsReportTotals(records);

    expect(totals.byStatus).toEqual([
      { status: 'PAID', count: 4, amount: '15000', tip: '500' },
      { status: 'FAILED', count: 3, amount: '9000', tip: '0' },
      { status: 'PENDING', count: 1, amount: '1000', tip: '0' },
    ]);
    expect(totals.byMethod).toEqual([
      { method: 'CASH', count: 2, amount: '8000', tip: '500' },
      { method: 'SIN_CLASIFICAR', count: 1, amount: '2000', tip: '0' },
      { method: 'CREDIT_CARD', count: 1, amount: '5000', tip: '0' },
    ]);
  });
});

describe('GetPaymentsReportService', () => {
  const resolveMock = jest.fn();
  const findPaymentsPageMock = jest.fn();
  const findPaymentStatusTotalsMock = jest.fn();
  const service = new GetPaymentsReportService(
    { resolve: resolveMock } as unknown as ReportScopeService,
    {
      findPaymentsPage: findPaymentsPageMock,
      findPaymentStatusTotals: findPaymentStatusTotalsMock,
    } as unknown as ReportsPrismaRepository,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    resolveMock.mockResolvedValue(scope);
    findPaymentStatusTotalsMock.mockResolvedValue([]);
  });

  it('forwards filters and paginates with a cursor built from the last visible row', async () => {
    findPaymentsPageMock.mockResolvedValue([
      record({ id: '11111111-1111-4111-8111-111111111111' }),
      record({
        id: '33333333-3333-4333-8333-333333333333',
        event_at: new Date('2026-07-15T12:00:00.000Z'),
      }),
    ]);

    const result = await service.execute(authUser, 'branch-1', {
      from: '2026-07-14',
      to: '2026-07-15',
      kind: 'payment',
      provider: 'MANUAL',
      paymentStatus: 'PAID',
      limit: 1,
    });

    expect(findPaymentsPageMock.mock.calls[0][0]).toMatchObject({
      kind: 'payment',
      provider: 'MANUAL',
      status: 'PAID',
      branchId: 'branch-1',
    });
    expect(findPaymentsPageMock.mock.calls[0][2]).toBe(2);
    expect(result.rows).toHaveLength(1);
    expect(result.nextCursor).not.toBeNull();
  });

  it('defaults to every kind of record', async () => {
    findPaymentsPageMock.mockResolvedValue([]);

    await service.execute(authUser, 'branch-1', {});

    expect(findPaymentsPageMock.mock.calls[0][0]).toMatchObject({
      kind: 'all',
      provider: null,
      status: null,
    });
  });

  it('exports a CSV with BOM, ; separator and Spanish headers', async () => {
    findPaymentsPageMock.mockResolvedValueOnce([record()]);

    const download = await service.executeCsv(authUser, 'branch-1', {
      from: '2026-07-14',
      to: '2026-07-15',
    });
    let text = '';

    for await (const chunk of download.stream) {
      text += String(chunk);
    }

    const lines = text.split('\r\n').filter((line) => line.length > 0);

    expect(download.filename).toBe('pagos_branch-1_2026-07-14_2026-07-15.csv');
    expect(lines[0]).toBe(BOM + PAYMENTS_CSV_HEADERS.join(';'));
    expect(lines[1]).toBe(
      '15-07-2026 23:30;15-07-2026 23:30;Pago;7;Mesa 1;Efectivo;MANUAL;manual-1;PAID;;;;10000;1000;11000;Caro Cajera;Caro Cajera;CASHIER;0',
    );
  });
});

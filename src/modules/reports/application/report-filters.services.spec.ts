import { LoginProfileType } from '../../auth/dto/login.dto';
import type {
  PaymentReportRecord,
  ReportsPrismaRepository,
} from '../infrastructure/reports.prisma.repository';
import { GetPaymentsReportService } from './get-payments-report.service';
import { GetSalesByHierarchyService } from './get-sales-by-hierarchy.service';
import { decodeCursor } from './report-cursor';
import type { ReportScopeService } from './report-scope.service';
import { EMPTY_FILTERS, type ReportScope } from './report-types';

const authUser = {
  sub: 'auth-1',
  profileType: LoginProfileType.STAFF,
  profileId: 'staff-1',
  restaurantId: 'restaurant-1',
};
const UUID = '11111111-1111-4111-8111-111111111111';

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

function record(extra: Partial<PaymentReportRecord> = {}): PaymentReportRecord {
  return {
    kind: 'PAYMENT',
    id: UUID,
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

describe('GetPaymentsReportService filters', () => {
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
    resolveMock.mockResolvedValue({
      ...scope,
      filters: {
        ...EMPTY_FILTERS,
        waiterId: UUID,
        sources: ['WEB_QR'],
        minAmount: 100,
        hasTip: true,
        q: 'mp',
      },
    });
    findPaymentsPageMock.mockResolvedValue([]);
    findPaymentStatusTotalsMock.mockResolvedValue([]);
  });

  it('feeds the very same filter to rows, totals and CSV', async () => {
    await service.execute(authUser, 'branch-1', { minAmount: 100 });
    const csv = await service.executeCsv(authUser, 'branch-1', {});

    for await (const chunk of csv.stream) {
      void chunk;
    }

    const rowsFilter = findPaymentsPageMock.mock.calls[0][0] as unknown;

    expect(rowsFilter).toMatchObject({
      waiterId: UUID,
      sources: ['WEB_QR'],
      minAmount: 100,
      hasTip: true,
      q: 'mp',
      timeZone: 'America/Santiago',
      orderBy: 'eventAt',
      direction: 'desc',
    });
    expect(findPaymentStatusTotalsMock.mock.calls[0][0]).toEqual(rowsFilter);
    expect(findPaymentsPageMock.mock.calls[1][0]).toEqual(rowsFilter);
  });

  it('forwards the requested ordering and echoes it in the response', async () => {
    const result = await service.execute(authUser, 'branch-1', {
      orderBy: 'amount',
      direction: 'asc',
    });

    expect(findPaymentsPageMock.mock.calls[0][0]).toMatchObject({
      orderBy: 'amount',
      direction: 'asc',
    });
    expect(result.orderBy).toBe('amount');
    expect(result.direction).toBe('asc');
  });

  it.each([
    ['eventAt', '2026-07-16T03:30:00.000Z', 'timestamp'],
    ['amount', '10000.00', 'number'],
    ['tip', '1000.00', 'number'],
  ] as const)(
    'builds the %s cursor from the last visible row',
    async (orderBy, expected, kind) => {
      findPaymentsPageMock.mockResolvedValue([
        record(),
        record({ id: '33333333-3333-4333-8333-333333333333' }),
      ]);

      const result = await service.execute(authUser, 'branch-1', {
        orderBy,
        limit: 1,
      });

      expect(decodeCursor(result.nextCursor ?? undefined, kind)).toEqual({
        value: expected,
        id: UUID,
      });
    },
  );

  it('rejects a cursor of another ordering kind', async () => {
    const cursor = Buffer.from(`2026-07-16T03:30:00.000Z|${UUID}`).toString(
      'base64url',
    );

    await expect(
      service.execute(authUser, 'branch-1', { orderBy: 'amount', cursor }),
    ).rejects.toThrow('cursor');
  });
});

describe('GetSalesByHierarchyService filters', () => {
  const resolveMock = jest.fn();
  const findHierarchyLinesMock = jest.fn();
  const service = new GetSalesByHierarchyService(
    { resolve: resolveMock } as unknown as ReportScopeService,
    {
      findHierarchyLines: findHierarchyLinesMock,
    } as unknown as ReportsPrismaRepository,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    findHierarchyLinesMock.mockResolvedValue([]);
  });

  it('applies the cashier, method and bill level filters of the scope to the lines query', async () => {
    resolveMock.mockResolvedValue({
      ...scope,
      cashierId: UUID,
      methods: ['CASH'],
      filters: {
        ...EMPTY_FILTERS,
        waiterId: UUID,
        zoneId: UUID,
        weekdays: [6, 7],
        timeFromMinute: 720,
      },
    });

    await service.execute(authUser, 'branch-1', {
      from: '2026-07-14',
      to: '2026-07-15',
      cashierId: UUID,
      method: 'CASH',
      waiterId: UUID,
      zoneId: UUID,
      weekdays: '6,7',
      timeFrom: '12:00',
    });

    expect(resolveMock).toHaveBeenCalledWith(
      authUser,
      'branch-1',
      expect.objectContaining({
        cashierId: UUID,
        method: 'CASH',
        waiterId: UUID,
        weekdays: '6,7',
        timeFrom: '12:00',
      }),
      { forCsv: false, fullAccessOnly: true },
    );
    expect(findHierarchyLinesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        cashierId: UUID,
        methods: ['CASH'],
        waiterId: UUID,
        zoneId: UUID,
        weekdays: [6, 7],
        timeFromMinute: 720,
        timeZone: 'America/Santiago',
        includeModifiers: true,
      }),
    );
  });

  it('applies the same filters to the CSV export', async () => {
    resolveMock.mockResolvedValue({
      ...scope,
      cashierId: UUID,
      filters: { ...EMPTY_FILTERS, tableId: UUID },
    });

    const csv = await service.executeCsv(authUser, 'branch-1', {});

    for await (const chunk of csv.stream) {
      void chunk;
    }

    expect(resolveMock).toHaveBeenCalledWith(
      authUser,
      'branch-1',
      expect.anything(),
      { forCsv: true, fullAccessOnly: true },
    );
    expect(findHierarchyLinesMock).toHaveBeenCalledWith(
      expect.objectContaining({ cashierId: UUID, tableId: UUID }),
    );
  });
});

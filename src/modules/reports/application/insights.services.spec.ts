import { ForbiddenException } from '@nestjs/common';
import { LoginProfileType } from '../../auth/dto/login.dto';
import type { ReportsInsightsPrismaRepository } from '../infrastructure/reports-insights.prisma.repository';
import { GetOpenTabsService } from './get-open-tabs.service';
import { GetSalesByMethodService } from './get-sales-by-method.service';
import { GetSalesByStaffService } from './get-sales-by-staff.service';
import { GetSalesByTimeService } from './get-sales-by-time.service';
import { GetSummaryKpisService } from './get-summary-kpis.service';
import { GetTipsReportService } from './get-tips-report.service';
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

async function read(stream: AsyncIterable<unknown>): Promise<string> {
  const chunks: string[] = [];

  for await (const chunk of stream) {
    chunks.push(String(chunk));
  }

  return chunks.join('');
}

describe('insights services', () => {
  const resolve = jest.fn();
  const resolveAccess = jest.fn();
  const repository = {
    findMethodBreakdown: jest.fn(),
    findWaiterBreakdown: jest.fn(),
    findCashierBreakdown: jest.fn(),
    findHourWeekday: jest.fn(),
    findPeriodBuckets: jest.fn(),
    findTipsByWaiterDay: jest.fn(),
    findTipPayouts: jest.fn(),
    findOpenTabs: jest.fn(),
    findKpiTotals: jest.fn(),
    countPhysicalTables: jest.fn(),
  };
  const scopeService = {
    resolve,
    resolveAccess,
  } as unknown as ReportScopeService;
  const insights = repository as unknown as ReportsInsightsPrismaRepository;

  beforeEach(() => {
    jest.resetAllMocks();
    resolve.mockResolvedValue(scope);
  });

  it('maps the total filters of the sales report and passes the bill filter to the repository', async () => {
    repository.findMethodBreakdown.mockResolvedValue([
      {
        method: 'CASH',
        payments: 1,
        bills: 1,
        amount: '1000',
        tip: '100',
        refunded: '0',
      },
    ]);
    const service = new GetSalesByMethodService(scopeService, insights);

    const response = await service.execute('x' as never, 'branch-1', {
      from: '2026-07-14',
      to: '2026-07-15',
      minTotal: 100,
      maxTotal: 900,
    });

    expect(resolve).toHaveBeenCalledWith(
      'x',
      'branch-1',
      expect.objectContaining({ minAmount: 100, maxAmount: 900 }),
      { forCsv: false },
    );
    expect(repository.findMethodBreakdown).toHaveBeenCalledWith(
      expect.objectContaining({
        branchId: 'branch-1',
        start: scope.start,
        end: scope.end,
        timeZone: 'America/Santiago',
      }),
    );
    expect(response.totals.net).toBe('1000');
    expect(response.rows[0].share).toBe(100);
  });

  it('exports the method report as CSV with the total row, over the CSV range limit', async () => {
    repository.findMethodBreakdown.mockResolvedValue([
      {
        method: 'CASH',
        payments: 2,
        bills: 2,
        amount: '3000',
        tip: '0',
        refunded: '0',
      },
    ]);
    const download = await new GetSalesByMethodService(
      scopeService,
      insights,
    ).executeCsv(authUser, 'branch-1', {});

    expect(resolve).toHaveBeenCalledWith(
      authUser,
      'branch-1',
      expect.anything(),
      { forCsv: true },
    );
    expect(download.filename).toBe(
      'ventas-por-medio_branch-1_2026-07-14_2026-07-15.csv',
    );
    expect(await read(download.stream)).toBe(
      `${BOM}Medio de pago;N° pagos;Monto;Propina;Reembolsado;Neto;Participacion %\r\nEfectivo;2;3000;0;0;3000;100\r\nTOTAL;2;3000;0;0;3000;100\r\n`,
    );
  });

  it('defaults the staff report to waiters and refuses it to a cashier scoped user', async () => {
    const service = new GetSalesByStaffService(scopeService, insights);

    repository.findWaiterBreakdown.mockResolvedValue([]);
    await service.execute(authUser, 'branch-1', {});
    expect(repository.findWaiterBreakdown).toHaveBeenCalledTimes(1);

    resolve.mockResolvedValue({
      ...scope,
      cashierScoped: true,
      cashierId: 's1',
    });
    await expect(
      service.execute(authUser, 'branch-1', { role: 'waiter' }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    repository.findCashierBreakdown.mockResolvedValue([]);
    await service.execute(authUser, 'branch-1', { role: 'cashier' });
    expect(repository.findCashierBreakdown).toHaveBeenCalledWith(
      expect.objectContaining({ cashierId: 's1' }),
    );
  });

  it('uses one hour and weekday query for the heatmap and a period query for days', async () => {
    const service = new GetSalesByTimeService(scopeService, insights);

    repository.findHourWeekday.mockResolvedValue([]);
    repository.findPeriodBuckets.mockResolvedValue([]);
    const hour = await service.execute(authUser, 'branch-1', {
      bucket: 'weekday',
    });
    const day = await service.execute(authUser, 'branch-1', { bucket: 'day' });

    expect(hour.rows).toHaveLength(7);
    expect(hour.heatmap?.amount).toHaveLength(7);
    expect(day.rows.map((row) => row.key)).toEqual([
      '2026-07-14',
      '2026-07-15',
    ]);
    expect(day.heatmap).toBeNull();
    expect(repository.findPeriodBuckets).toHaveBeenCalledWith(
      expect.anything(),
      'day',
    );
  });

  it('builds the tips report from both queries', async () => {
    repository.findTipsByWaiterDay.mockResolvedValue([
      {
        staff_id: 'w1',
        name: 'Ana',
        day: '2026-07-14',
        bills: 1,
        sales: '10000',
        tip: '1000',
        returned: '0',
      },
    ]);
    repository.findTipPayouts.mockResolvedValue([]);
    const response = await new GetTipsReportService(
      scopeService,
      insights,
    ).execute(authUser, 'branch-1', {});

    expect(response.totals).toMatchObject({ tip: '1000', tipPercent: 10 });
    expect(response.byWaiter[0].payoutStatus).toBe('NO_CARD_TIPS');
  });

  describe('open tabs', () => {
    const service = new GetOpenTabsService(scopeService, insights);

    it('does not need a range for the open kind and refuses cashiers', async () => {
      resolveAccess.mockResolvedValue({
        timeZone: 'America/Santiago',
        cashierScoped: true,
      });
      await expect(
        service.execute(authUser, 'branch-1', {}),
      ).rejects.toBeInstanceOf(ForbiddenException);

      resolveAccess.mockResolvedValue({
        timeZone: 'America/Santiago',
        cashierScoped: false,
      });
      repository.findOpenTabs.mockResolvedValue([]);
      const response = await service.execute(authUser, 'branch-1', {
        waiterId: '11111111-1111-4111-8111-111111111111',
      });

      expect(resolve).not.toHaveBeenCalled();
      expect(response).toMatchObject({
        kind: 'open',
        from: null,
        to: null,
        alertAfterMinutes: 180,
        truncated: false,
      });
      expect(repository.findOpenTabs).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'open',
          waiterId: '11111111-1111-4111-8111-111111111111',
          limit: 501,
        }),
      );
    });

    it('resolves the range with full access only for abandoned and cancelled', async () => {
      repository.findOpenTabs.mockResolvedValue([]);
      await service.execute(authUser, 'branch-1', {
        kind: 'abandoned',
        from: '2026-07-14',
        to: '2026-07-15',
      });

      expect(resolve).toHaveBeenCalledWith(
        authUser,
        'branch-1',
        expect.anything(),
        {
          forCsv: false,
          fullAccessOnly: true,
        },
      );
      expect(repository.findOpenTabs).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'abandoned',
          start: scope.start,
          end: scope.end,
        }),
      );
    });

    it('flags truncated results beyond 500 rows', async () => {
      resolveAccess.mockResolvedValue({
        timeZone: 'America/Santiago',
        cashierScoped: false,
      });
      const record = {
        session_id: 'aaaaaaaa-0000-4000-8000-0000000000a1',
        bill_id: null,
        ticket_number: 1,
        is_counter: false,
        customer_label: null,
        guest_count: 1,
        session_status: 'OPEN',
        bill_status: null,
        table_name: 'M1',
        zone_name: null,
        waiter_name: null,
        opened_at: new Date(),
        ended_at: null,
        close_reason: null,
        total: 0,
        paid: 0,
        pending: 0,
        cancelled_orders: null,
        cancelled_amount: null,
      };

      repository.findOpenTabs.mockResolvedValue(
        Array.from({ length: 501 }, () => record),
      );
      const response = await service.execute(authUser, 'branch-1', {});

      expect(response.rows).toHaveLength(500);
      expect(response.truncated).toBe(true);
    });
  });

  describe('summary kpis', () => {
    const totals = {
      bills: 2,
      table_bills: 2,
      guests: 4,
      gross: '10000',
      tip: '1000',
      refunded: '0',
    };

    it('only queries the previous range when asked and never for a cashier scoped user', async () => {
      repository.countPhysicalTables.mockResolvedValue(2);
      repository.findKpiTotals.mockResolvedValue(totals);
      const service = new GetSummaryKpisService(scopeService, insights);

      const none = await service.execute(authUser, 'branch-1', {});
      expect(repository.findKpiTotals).toHaveBeenCalledTimes(1);
      expect([none.previous, none.delta]).toEqual([null, null]);

      repository.findKpiTotals.mockClear();
      const both = await service.execute(authUser, 'branch-1', {
        compare: 'previous',
      });
      expect(repository.findKpiTotals).toHaveBeenCalledTimes(2);
      expect(repository.findKpiTotals).toHaveBeenLastCalledWith(
        expect.objectContaining({
          start: new Date('2026-07-12T04:00:00.000Z'),
          end: scope.start,
        }),
      );
      expect(both.previousRange).toEqual({
        from: '2026-07-12',
        to: '2026-07-13',
      });
      expect(both.delta?.netSales).toEqual({ absolute: '0', percent: 0 });

      resolve.mockResolvedValue({
        ...scope,
        cashierScoped: true,
        cashierId: 's1',
      });
      repository.findKpiTotals.mockClear();
      const cashier = await service.execute(authUser, 'branch-1', {
        compare: 'previous',
      });
      expect(repository.findKpiTotals).toHaveBeenCalledTimes(1);
      expect(cashier.previous).toBeNull();
    });

    it('exports one line per indicator', async () => {
      repository.countPhysicalTables.mockResolvedValue(0);
      repository.findKpiTotals.mockResolvedValue(totals);
      const download = await new GetSummaryKpisService(
        scopeService,
        insights,
      ).executeCsv(authUser, 'branch-1', { compare: 'previous' });
      const lines = (await read(download.stream)).split('\r\n');

      expect(lines[0]).toBe(
        `${BOM}Indicador;Actual;Anterior;Variacion;Variacion %`,
      );
      expect(lines[3]).toBe('Venta neta;10000;10000;0;0');
      expect(lines).toHaveLength(10);
    });
  });
});

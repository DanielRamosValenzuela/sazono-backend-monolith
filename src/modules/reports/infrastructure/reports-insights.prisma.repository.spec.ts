import type { Prisma } from '@prisma/client';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import { EMPTY_FILTERS } from '../application/report-types';
import { ReportsInsightsPrismaRepository } from './reports-insights.prisma.repository';

describe('ReportsInsightsPrismaRepository', () => {
  const queryRawMock = jest.fn();
  const repository = new ReportsInsightsPrismaRepository({
    $queryRaw: queryRawMock,
  } as unknown as PrismaService);
  const branchId = '11111111-1111-4111-8111-111111111111';
  const filter = {
    ...EMPTY_FILTERS,
    branchId,
    start: new Date('2026-07-14T04:00:00.000Z'),
    end: new Date('2026-07-16T04:00:00.000Z'),
    timeZone: 'America/Santiago',
    cashierId: null,
    methods: [],
  };

  async function last(run: () => Promise<unknown>): Promise<Prisma.Sql> {
    queryRawMock.mockResolvedValue([{}]);
    await run();

    return queryRawMock.mock.calls[
      queryRawMock.mock.calls.length - 1
    ][0] as Prisma.Sql;
  }

  beforeEach(() => {
    queryRawMock.mockReset();
  });

  it('builds the method breakdown over the eligible bills and subtracts the refunds of the period', async () => {
    const query = await last(() => repository.findMethodBreakdown(filter));
    const flat = query.sql.replace(/\s+/g, ' ');

    expect(query.sql).toContain('SUM(p.amount - p.tip_amount)');
    expect(flat).toContain('FROM refunds r');
    expect(flat).toContain("r.status = 'SUCCEEDED'");
    expect(flat).toContain('r.completed_at >=');
    expect(flat).toContain('UNION ALL');
    expect(query.sql).toContain("p.status = 'PAID'");
    expect(query.sql).toContain('GROUP BY 1');
    expect(query.values).toEqual(
      expect.arrayContaining([branchId, filter.start, filter.end]),
    );
  });

  it.each([
    ['method', () => repository.findMethodBreakdown(filter)],
    ['waiter', () => repository.findWaiterBreakdown(filter)],
    ['cashier', () => repository.findCashierBreakdown(filter)],
  ])(
    'drops the zero consumption refund rows of tip-only refunds in the %s breakdown',
    async (_name, run) => {
      const query = await last(run);

      expect(query.sql.replace(/\s+/g, ' ')).toContain(
        ') x WHERE x.consumption <> 0 GROUP BY',
      );
    },
  );

  it('attributes the waiter with the three fallbacks in order', async () => {
    const query = await last(() => repository.findWaiterBreakdown(filter));
    const flat = query.sql.replace(/\s+/g, ' ');

    expect(flat).toContain(
      'COALESCE(ts.assigned_staff_user_id, ts.opened_by_staff_user_id, oc.staff_id) AS waiter_id',
    );
    expect(flat).toContain(
      'o.created_by_staff_user_id IS NOT NULL ORDER BY o.created_at ASC, o.id ASC LIMIT 1',
    );
  });

  it('counts a bill once per cashier and separates the online payments', async () => {
    const query = await last(() => repository.findCashierBreakdown(filter));
    const flat = query.sql.replace(/\s+/g, ' ');

    expect(flat).toContain('GROUP BY e.id, e.guest_count, p.staff_user_id');
    expect(flat).toContain("p.source = 'WEB_QR'");
  });

  it('buckets in the restaurant timezone with ISO weekdays and never inlines the zone', async () => {
    const heat = await last(() => repository.findHourWeekday(filter));
    const days = await last(() => repository.findPeriodBuckets(filter, 'day'));
    const months = await last(() =>
      repository.findPeriodBuckets(filter, 'month'),
    );

    expect(heat.sql).toContain('EXTRACT(ISODOW FROM x.local_at)');
    expect(heat.sql).toContain('AT TIME ZONE');
    expect(heat.sql).not.toContain('America/Santiago');
    expect(heat.values).toContain('America/Santiago');
    expect(days.values).toContain('YYYY-MM-DD');
    expect(months.values).toContain('YYYY-MM');
  });

  it('computes tip payouts per paid day for card methods passed as parameters', async () => {
    const query = await last(() => repository.findTipPayouts(filter));

    expect(query.sql).toContain('p.tip_amount > 0');
    expect(query.sql).toContain('FILTER (WHERE p.method::text IN');
    expect(query.sql).toContain('p.tip_amount - p.refunded_tip_amount');
    expect(query.values).toEqual(
      expect.arrayContaining([
        'CREDIT_CARD',
        'DEBIT_CARD',
        'MERCADO_PAGO',
        'MACH',
      ]),
    );
  });

  it.each([
    ['open', "ts.status::text = 'OPEN'", 'ORDER BY ts.opened_at ASC'],
    [
      'abandoned',
      "ts.status::text = 'ABANDONED'",
      'ORDER BY ts.closed_at DESC',
    ],
    ['cancelled', "o.status::text = 'CANCELLED'", 'ORDER BY cx.last_at DESC'],
  ] as const)(
    'filters the %s tabs by kind with parameterised limits',
    async (kind, condition, order) => {
      const query = await last(() =>
        repository.findOpenTabs({
          kind,
          branchId,
          start: filter.start,
          end: filter.end,
          waiterId: branchId,
          tableId: null,
          zoneId: null,
          limit: 501,
        }),
      );
      const flat = query.sql.replace(/\s+/g, ' ');

      expect(flat).toContain(condition);
      expect(flat).toContain(order);
      expect(flat).toContain('ts.assigned_staff_user_id = ?::uuid');
      expect(query.values).toEqual(expect.arrayContaining([branchId, 501]));
    },
  );

  it('returns the single kpi row and the physical table count', async () => {
    queryRawMock.mockResolvedValueOnce([{ bills: 3 }]);
    await expect(repository.findKpiTotals(filter)).resolves.toEqual({
      bills: 3,
    });

    queryRawMock.mockResolvedValueOnce([{ total: 7 }]);
    await expect(repository.countPhysicalTables(branchId)).resolves.toBe(7);
    queryRawMock.mockResolvedValueOnce([]);
    await expect(repository.countPhysicalTables(branchId)).resolves.toBe(0);
  });
});

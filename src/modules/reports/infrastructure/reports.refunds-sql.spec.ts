import type { Prisma } from '@prisma/client';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import { EMPTY_FILTERS } from '../application/report-types';
import { ReportsPrismaRepository } from './reports.prisma.repository';
import {
  periodRefundsSql,
  refundJoinSql,
  type RefundsReportFilter,
} from './report-sql';

describe('refund SQL shape', () => {
  const queryRawMock = jest.fn();
  const repository = new ReportsPrismaRepository({
    $queryRaw: queryRawMock,
  } as unknown as PrismaService);
  const branchId = '11111111-1111-4111-8111-111111111111';
  const uuid = '22222222-2222-4222-8222-222222222222';
  const start = new Date('2026-07-14T04:00:00.000Z');
  const end = new Date('2026-07-16T04:00:00.000Z');
  const base = {
    ...EMPTY_FILTERS,
    branchId,
    start,
    end,
    timeZone: 'America/Santiago',
    cashierId: null,
    methods: [],
  };
  const refundsFilter: RefundsReportFilter = {
    branchId,
    start,
    end,
    timeZone: 'America/Santiago',
    scopedToStaffUserId: null,
    cashierId: null,
    requestedById: null,
    methods: [],
    sources: [],
    reasonCodes: [],
    refundStatuses: [],
    refundMethods: [],
    waiterId: null,
    tableId: null,
    zoneId: null,
    minAmount: null,
    maxAmount: null,
    hasTip: null,
    minTip: null,
    timeFromMinute: null,
    timeToMinute: null,
    weekdays: [],
    q: null,
  };

  async function last(run: () => Promise<unknown>): Promise<Prisma.Sql> {
    queryRawMock.mockResolvedValue([]);
    await run();

    return queryRawMock.mock.calls[
      queryRawMock.mock.calls.length - 1
    ][0] as Prisma.Sql;
  }

  beforeEach(() => {
    queryRawMock.mockReset();
  });

  describe('refundJoinSql', () => {
    it('is a correlated lateral over succeeded refunds in a half open range', () => {
      const sql = refundJoinSql({ start, end });

      expect(sql.sql).toContain('LEFT JOIN LATERAL');
      expect(sql.sql).toContain('rr.payment_id = p.id');
      expect(sql.sql).toContain("rr.status = 'SUCCEEDED'");
      expect(sql.sql).toContain('rr.completed_at >= ?');
      expect(sql.sql).toContain('rr.completed_at < ?');
      expect(sql.sql).toContain('SUM(rr.amount - rr.tip_amount)');
      expect(sql.sql).toContain('SUM(rr.tip_amount)');
      expect(sql.sql).toContain(') rf ON TRUE');
      expect(sql.values).toEqual([start, end]);
    });

    it('accepts another payment and alias without concatenating values', () => {
      const sql = refundJoinSql({ start, end }, 'pay', 'x');

      expect(sql.sql).toContain('rr.payment_id = pay.id');
      expect(sql.sql).toContain(') x ON TRUE');
    });
  });

  it('attributes period refunds by refund date and limits them to the eligible bills only under closure filters', () => {
    const open = periodRefundsSql(base).sql.replace(/\s+/g, ' ');
    const closed = periodRefundsSql({ ...base, weekdays: [3] }).sql.replace(
      /\s+/g,
      ' ',
    );

    expect(open).toContain("r.status = 'SUCCEEDED'");
    expect(open).toContain('r.completed_at >=');
    expect(open).toContain('(r.amount - r.tip_amount) AS consumption');
    expect(open).not.toContain('b.id IN (SELECT ce.id');
    expect(closed).toContain('b.id IN (SELECT ce.id');
  });

  it('adds refunded and tip refunded to the eligible bills aggregate', async () => {
    const query = await last(() =>
      repository.findMethodTotals({ ...base, orderBy: 'closedAt' } as never),
    );

    expect(query.sql).toContain('COALESCE(SUM(rf.consumption), 0) AS refunded');
    expect(query.sql).toContain('COALESCE(SUM(rf.tip), 0) AS tip_refunded');
    expect(query.sql).toContain('agg.refunded');
    expect(query.sql).toContain('agg.tip_refunded');
    expect(query.sql).toContain('AS refunded_tip');
    expect(query.sql).toContain("rr.status = 'SUCCEEDED'");
  });

  it('adds refunded to the payments json of every bill row', async () => {
    const query = await last(() =>
      repository.findBillPage(
        { ...base, orderBy: 'closedAt', direction: 'desc' },
        null,
        51,
      ),
    );

    expect(query.sql).toContain(
      "'refunded', COALESCE(rf.consumption, 0)::text",
    );
    expect(query.sql).toContain("'refunded_tip', COALESCE(rf.tip, 0)::text");
  });

  it('adds refunded to payments rows and zeros to attempts', async () => {
    const query = await last(() =>
      repository.findPaymentsPage(
        {
          ...base,
          kind: 'all',
          provider: null,
          status: null,
          orderBy: 'eventAt',
          direction: 'desc',
        },
        null,
        51,
      ),
    );

    expect(query.sql).toContain('COALESCE(rf.consumption, 0) AS refunded');
    expect(query.sql).toContain('0::numeric AS refunded,');
    expect(query.sql).toContain("'NONE'::text AS refund_status");
    expect(query.sql).toContain('p.refunded_amount >= p.amount');
    expect(query.sql).toContain('r.refunded_tip');
  });

  it('sums the refunded amounts in the payments totals', async () => {
    const query = await last(() =>
      repository.findPaymentStatusTotals({
        ...base,
        kind: 'all',
        provider: null,
        status: null,
      }),
    );

    expect(query.sql).toContain('SUM(r.refunded)');
    expect(query.sql).toContain('SUM(r.refunded_tip)');
  });

  describe('findRefundsByMethod', () => {
    it('groups succeeded refunds of the range by method with the payment conditions', async () => {
      const query = await last(() =>
        repository.findRefundsByMethod({
          ...base,
          cashierId: uuid,
          methods: ['CASH', 'SIN_CLASIFICAR'],
          sources: ['CASHIER'],
          waiterId: uuid,
          tableId: uuid,
          zoneId: uuid,
          provider: 'MANUAL',
        }),
      );

      expect(query.sql).toContain('FROM refunds r');
      expect(query.sql).toContain("r.status = 'SUCCEEDED'");
      expect(query.sql).toContain('r.completed_at >= ?');
      expect(query.sql).toContain('r.completed_at < ?');
      expect(query.sql).toContain("p.status = 'PAID'");
      expect(query.sql).toContain('p.staff_user_id = ?::uuid');
      expect(query.sql).toContain('p.method IS NULL');
      expect(query.sql).toContain('p.source IN');
      expect(query.sql).toContain('p.provider = ?');
      expect(query.sql).toContain('ts.assigned_staff_user_id = ?::uuid');
      expect(query.sql).toContain('t.id = ?::uuid');
      expect(query.sql).toContain('t.zone_id = ?::uuid');
      expect(query.sql).toContain('GROUP BY 1');
      expect(query.sql).not.toContain(uuid);
    });
  });

  describe('refundsFilteredSql through findRefundsPage', () => {
    const page = (filter: Partial<RefundsReportFilter> = {}) =>
      last(() =>
        repository.findRefundsPage(
          {
            ...refundsFilter,
            ...filter,
            orderBy: 'completedAt',
            direction: 'desc',
          },
          null,
          51,
        ),
      );

    it('filters by branch and the half open completed_at range with a stable keyset order', async () => {
      const query = await page();

      expect(query.sql).toContain('r.branch_id = ?::uuid');
      expect(query.sql).toContain('r.completed_at >= ?');
      expect(query.sql).toContain('r.completed_at < ?');
      expect(query.sql).toContain('ORDER BY x.completed_at DESC, x.id DESC');
      expect(query.sql).toContain('bill_has_active_orders');
      expect(query.sql).toMatch(/ao\.status::text IN \(\?(,\s?\?){4}\)/);
      expect(query.values).toContain(51);
      expect(query.values).toEqual(
        expect.arrayContaining([
          'CONFIRMED',
          'ROUTED',
          'IN_PREPARATION',
          'PARTIALLY_READY',
          'READY',
        ]),
      );
    });

    it('limits a cashier to the refunds he registered', async () => {
      const query = await page({ scopedToStaffUserId: uuid });

      expect(query.sql).toContain('r.requested_by_staff_user_id = ?::uuid');
      expect(query.values).toContain(uuid);
      expect(query.sql).not.toContain(uuid);
    });

    it('applies every filter as a bound parameter', async () => {
      const query = await page({
        requestedById: uuid,
        cashierId: uuid,
        methods: ['CASH'],
        sources: ['CASHIER'],
        reasonCodes: ['OTHER', 'WRONG_ORDER'],
        refundStatuses: ['SUCCEEDED'],
        refundMethods: ['CASH_MANUAL'],
        waiterId: uuid,
        tableId: uuid,
        zoneId: uuid,
        minAmount: 1000,
        maxAmount: 9000,
        hasTip: true,
        minTip: 100,
        timeFromMinute: 600,
        timeToMinute: 900,
        weekdays: [1, 2],
        q: 'plato 100%',
      });

      expect(query.sql).toMatch(/r\.reason_code::text IN \(\?,\s?\?\)/);
      expect(query.sql).toContain('r.status::text IN (?)');
      expect(query.sql).toContain('r.method::text IN (?)');
      expect(query.sql).toContain('p.staff_user_id = ?::uuid');
      expect(query.sql).toContain('p.method::text IN');
      expect(query.sql).toContain('p.source IN');
      expect(query.sql).toContain('r.amount >= ?::numeric');
      expect(query.sql).toContain('r.amount <= ?::numeric');
      expect(query.sql).toContain('r.tip_amount > 0');
      expect(query.sql).toContain('r.tip_amount >= ?::numeric');
      expect(query.sql).toContain('(r.completed_at AT TIME ZONE ?::text)');
      expect(query.sql).toContain('EXTRACT(ISODOW FROM');
      expect(query.sql).toContain("ILIKE ? ESCAPE '!'");
      expect(query.sql).toContain('r.reason_text');
      expect(query.values).toEqual(
        expect.arrayContaining(
          ['OTHER', 'WRONG_ORDER', 'plato 100%'].map((value) =>
            value === 'plato 100%' ? '%plato 100!%%' : value,
          ),
        ),
      );
      expect(query.sql).not.toContain('plato');
    });

    it('supports ordering by amount', async () => {
      const query = await last(() =>
        repository.findRefundsPage(
          { ...refundsFilter, orderBy: 'amount', direction: 'asc' },
          { value: '3000.00', id: uuid },
          51,
        ),
      );

      expect(query.sql).toContain('ORDER BY x.amount ASC, x.id ASC');
      expect(query.sql).toContain('x.amount > ?::numeric');
    });
  });

  it('groups the refund totals by method, reason and requester', async () => {
    const query = await last(() => repository.findRefundTotals(refundsFilter));

    expect(query.sql).toContain(
      'GROUP BY x.payment_method, x.reason_code, x.requested_by_staff_user_id',
    );
    expect(query.sql).toContain('SUM(x.net_amount)');
  });

  it('reads the refunds of an order detail scoped to a requester only when asked', async () => {
    queryRawMock.mockResolvedValue([]);
    await repository.findOrderDetail(branchId, uuid);
    const all = queryRawMock.mock.calls
      .map((call) => (call[0] as Prisma.Sql).sql)
      .find((sql) => sql.includes('FROM refunds r')) as string;

    expect(all).not.toContain('r.requested_by_staff_user_id = ?::uuid');

    queryRawMock.mockReset();
    queryRawMock.mockResolvedValue([]);
    await repository.findOrderDetail(branchId, uuid, uuid);
    const scoped = queryRawMock.mock.calls
      .map((call) => (call[0] as Prisma.Sql).sql)
      .find((sql) => sql.includes('FROM refunds r')) as string;

    expect(scoped).toContain('r.requested_by_staff_user_id = ?::uuid');
  });

  it('loads the refund items of all refunds in one batch query', async () => {
    queryRawMock.mockReset();
    queryRawMock
      .mockResolvedValueOnce([{ id: 'r1' }, { id: 'r2' }])
      .mockResolvedValueOnce([
        { refund_id: 'r2', bill_item_id: 'b1', name: 'Pizza' },
      ]);
    const rows = await repository.findRefundsPage(
      {
        ...refundsFilter,
        orderBy: 'completedAt',
        direction: 'desc',
      },
      null,
      51,
    );
    const itemsQuery = queryRawMock.mock.calls[1][0] as Prisma.Sql;

    expect(queryRawMock).toHaveBeenCalledTimes(2);
    expect(itemsQuery.sql).toContain('FROM refund_items ri');
    expect(itemsQuery.values).toEqual(['r1', 'r2']);
    expect(rows).toEqual([
      { id: 'r1', items: [] },
      { id: 'r2', items: [{ bill_item_id: 'b1', name: 'Pizza' }] },
    ]);
  });
});

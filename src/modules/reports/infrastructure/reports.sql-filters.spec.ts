import type { Prisma } from '@prisma/client';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import { EMPTY_FILTERS } from '../application/report-types';
import { ReportsPrismaRepository } from './reports.prisma.repository';

describe('ReportsPrismaRepository filters', () => {
  const queryRawMock = jest.fn();
  const repository = new ReportsPrismaRepository({
    $queryRaw: queryRawMock,
  } as unknown as PrismaService);
  const branchId = '11111111-1111-4111-8111-111111111111';
  const uuid = '22222222-2222-4222-8222-222222222222';
  const base = {
    ...EMPTY_FILTERS,
    branchId,
    start: new Date('2026-07-14T04:00:00.000Z'),
    end: new Date('2026-07-16T04:00:00.000Z'),
    timeZone: 'America/Santiago',
    cashierId: null,
    methods: [],
  };
  const billFilter = {
    ...base,
    orderBy: 'closedAt' as const,
    direction: 'desc' as const,
  };
  const paymentsFilter = {
    ...base,
    kind: 'all' as const,
    provider: null,
    status: null,
    orderBy: 'eventAt' as const,
    direction: 'desc' as const,
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

  describe('findBillPage', () => {
    it('orders by closing time descending with a bill id tie-break and no cursor by default', async () => {
      const query = await last(() =>
        repository.findBillPage(billFilter, null, 51),
      );

      expect(query.sql).toContain('ORDER BY e.closed_at DESC, e.id DESC');
      expect(query.sql).toContain('ORDER BY pg.closed_at DESC, pg.id DESC');
      expect(query.sql).not.toContain('WHERE (e.');
      expect(query.values).toContain(51);
    });

    it.each([
      ['closedAt', 'closed_at', '::timestamptz', '2026-07-15T20:00:00.000Z'],
      ['total', 'total', '::numeric', '10000.00'],
      ['tip', 'tip', '::numeric', '1000.00'],
      ['orderNumber', 'order_key', '::text COLLATE "C"', '000201'],
    ] as const)(
      'builds a stable keyset for %s ascending and descending',
      async (orderBy, column, cast, value) => {
        const asc = await last(() =>
          repository.findBillPage(
            { ...billFilter, orderBy, direction: 'asc' },
            { value, id: uuid },
            10,
          ),
        );
        const desc = await last(() =>
          repository.findBillPage(
            { ...billFilter, orderBy, direction: 'desc' },
            { value, id: uuid },
            10,
          ),
        );

        expect(asc.sql).toContain(
          `WHERE (e.${column} > ?${cast} OR (e.${column} = ?${cast} AND e.id > ?::uuid))`,
        );
        expect(asc.sql).toContain(`ORDER BY e.${column} ASC, e.id ASC`);
        expect(desc.sql).toContain(
          `WHERE (e.${column} < ?${cast} OR (e.${column} = ?${cast} AND e.id < ?::uuid))`,
        );
        expect(desc.sql).toContain(`ORDER BY e.${column} DESC, e.id DESC`);
        expect(asc.values).toEqual(
          expect.arrayContaining([value, uuid, branchId]),
        );
        expect(asc.sql).not.toContain(value);
      },
    );

    it('embeds the payments of the page bills so no second round trip is needed', async () => {
      const query = await last(() =>
        repository.findBillPage(billFilter, null, 10),
      );

      expect(query.sql).toContain('json_agg');
      expect(query.sql).toContain('LEFT JOIN LATERAL');
      expect(query.sql).toContain('WHERE p.bill_id = pg.id');
    });

    it('applies the bill level filters with bound parameters only', async () => {
      const query = await last(() =>
        repository.findBillPage(
          {
            ...billFilter,
            waiterId: uuid,
            tableId: uuid,
            zoneId: uuid,
            billStatuses: ['MIXED'],
            minAmount: 1000,
            maxAmount: 9000,
            hasTip: true,
            minTip: 200,
            sources: ['WEB_QR'],
            cashierId: uuid,
            methods: ['CASH', 'SIN_CLASIFICAR'],
          },
          null,
          10,
        ),
      );

      expect(query.sql).toContain('ts.assigned_staff_user_id = ?::uuid');
      expect(query.sql).toContain('t.id = ?::uuid');
      expect(query.sql).toContain('t.zone_id = ?::uuid');
      expect(query.sql).toContain('agg.method_count > 1');
      expect(query.sql).toContain('agg.total >= ?::numeric');
      expect(query.sql).toContain('agg.total <= ?::numeric');
      expect(query.sql).toContain('agg.tip > 0');
      expect(query.sql).toContain('agg.tip >= ?::numeric');
      expect(query.sql).toContain('p.source IN (?)');
      expect(query.sql).toContain('p.staff_user_id = ?::uuid');
      expect(query.sql).toContain('p.method IS NULL');
      expect(query.values).toEqual(
        expect.arrayContaining([uuid, 1000, 9000, 200, 'WEB_QR', 'CASH']),
      );
      expect(query.sql).not.toContain(uuid);
    });

    it('maps PAID_FULL to a single method and both statuses to no restriction', async () => {
      const full = await last(() =>
        repository.findBillPage(
          { ...billFilter, billStatuses: ['PAID_FULL'] },
          null,
          10,
        ),
      );
      const both = await last(() =>
        repository.findBillPage(
          { ...billFilter, billStatuses: ['PAID_FULL', 'MIXED'] },
          null,
          10,
        ),
      );

      expect(full.sql).toContain('agg.method_count <= 1');
      expect(both.sql).not.toContain('agg.method_count <=');
      expect(both.sql).not.toContain('agg.method_count >');
    });

    it('searches case-insensitively with an explicit escape character and a pre-escaped bound pattern', async () => {
      const query = await last(() =>
        repository.findBillPage({ ...billFilter, q: '50%_off!' }, null, 10),
      );

      expect(query.sql).toContain("ILIKE ? ESCAPE '!'");
      expect(query.sql).toContain('ts.customer_label');
      expect(query.sql).toContain('t.name');
      expect(query.sql).toContain('CONCAT(wu.first_name');
      expect(query.sql).toContain('CONCAT(qs.first_name');
      expect(query.values).toContain('%50!%!_off!!%');
      expect(query.sql).not.toContain('50');
    });

    it('never lets injection-like search text reach the SQL string', async () => {
      const hostile = "'; DROP TABLE bills; --";
      const query = await last(() =>
        repository.findBillPage(
          {
            ...billFilter,
            q: hostile,
            productName: hostile,
            categoryPath: [hostile, 'b'],
          },
          null,
          10,
        ),
      );

      expect(query.sql).not.toContain('DROP');
      expect(query.sql).not.toContain(hostile);
      expect(query.values).toEqual(
        expect.arrayContaining([`%${hostile}%`, hostile]),
      );
    });

    it('filters the local time of day with a single range and across midnight', async () => {
      const day = await last(() =>
        repository.findBillPage(
          { ...billFilter, timeFromMinute: 720, timeToMinute: 900 },
          null,
          10,
        ),
      );
      const night = await last(() =>
        repository.findBillPage(
          { ...billFilter, timeFromMinute: 1320, timeToMinute: 120 },
          null,
          10,
        ),
      );
      const onlyFrom = await last(() =>
        repository.findBillPage(
          { ...billFilter, timeFromMinute: 600 },
          null,
          10,
        ),
      );

      expect(day.sql).toContain('AT TIME ZONE ?::text');
      expect(day.sql).toContain('>= ?::int');
      expect(day.sql).toContain('<= ?::int');
      expect(day.sql).not.toContain('>= ?::int OR');
      expect(night.sql).toContain('>= ?::int OR');
      expect(night.values).toEqual(expect.arrayContaining([1320, 120]));
      expect(onlyFrom.sql).toContain('>= ?::int');
      expect(onlyFrom.sql).not.toContain('<= ?::int');
      expect(day.values).toContain('America/Santiago');
    });

    it('filters ISO weekdays in the restaurant timezone', async () => {
      const query = await last(() =>
        repository.findBillPage(
          { ...billFilter, weekdays: [1, 6, 7] },
          null,
          10,
        ),
      );

      expect(query.sql).toContain('EXTRACT(ISODOW FROM');
      expect(query.sql).toContain('::int IN (?,?,?)');
      expect(query.values).toEqual(expect.arrayContaining([1, 6, 7]));
    });

    it('matches bills containing sold items by product id, product name and category prefix', async () => {
      const query = await last(() =>
        repository.findBillPage(
          {
            ...billFilter,
            productId: uuid,
            productName: 'Cafe Latte',
            categoryPath: ['Cafe', 'Bebidas Calientes'],
          },
          null,
          10,
        ),
      );

      expect(query.sql).toContain('EXISTS (');
      expect(query.sql).toContain('oi.menu_item_id = ?::uuid');
      expect(query.sql).toContain('LOWER(oi.name_snapshot) = LOWER(?::text)');
      expect(query.sql).toContain('cardinality(ARRAY[?,?]::text[])');
      expect(query.sql).toContain("oi.status::text <> 'CANCELLED'");
      expect(query.values).toEqual(
        expect.arrayContaining([
          uuid,
          'Cafe Latte',
          'Cafe',
          'Bebidas Calientes',
          '(Sin categoria)',
          'CONFIRMED',
        ]),
      );
    });

    it('adds no extra conditions for an empty filter set', async () => {
      const query = await last(() =>
        repository.findBillPage(billFilter, null, 10),
      );

      expect(query.sql).not.toContain('ILIKE');
      expect(query.sql).not.toContain('AT TIME ZONE');
      expect(query.sql).not.toContain('agg.method_count >');
      expect(query.sql).not.toContain('agg.method_count <=');
      expect(query.sql).not.toContain('menu_item_id');
    });
  });

  describe('findMethodTotals', () => {
    it('reuses the exact eligible bill set for the totals and counts the bills in the same statement', async () => {
      const filter = { ...billFilter, waiterId: uuid, q: 'ana' };
      const page = await last(() => repository.findBillPage(filter, null, 10));
      const totals = await last(() => repository.findMethodTotals(filter));

      expect(totals.sql).toContain('WITH e AS (');
      expect(totals.sql).toContain('bill_count');
      expect(totals.sql).toContain('(SELECT bills FROM bill_count) AS bills');
      expect(totals.sql).toContain('ts.assigned_staff_user_id = ?::uuid');
      expect(totals.sql).toContain("ILIKE ? ESCAPE '!'");
      expect(totals.values).toEqual(
        expect.arrayContaining([uuid, '%ana%', branchId]),
      );
      expect(page.values).toEqual(
        expect.arrayContaining([uuid, '%ana%', branchId]),
      );
    });
  });

  describe('findHierarchyLines', () => {
    it('applies the bill level filters to the eligible bills', async () => {
      const query = await last(() =>
        repository.findHierarchyLines({
          ...base,
          waiterId: uuid,
          zoneId: uuid,
          weekdays: [6, 7],
          sources: ['CASHIER'],
          cashierId: uuid,
          methods: ['CASH'],
          includeModifiers: true,
        }),
      );

      expect(query.sql).toContain('ts.assigned_staff_user_id = ?::uuid');
      expect(query.sql).toContain('t.zone_id = ?::uuid');
      expect(query.sql).toContain('EXTRACT(ISODOW FROM');
      expect(query.sql).toContain('p.source IN (?)');
      expect(query.sql).toContain('p.staff_user_id = ?::uuid');
    });
  });

  describe('findPaymentsPage', () => {
    it.each([
      ['eventAt', 'event_at', '::timestamptz', '2026-07-15T20:00:00.000Z'],
      ['amount', 'amount', '::numeric', '5000.00'],
      ['tip', 'tip', '::numeric', '0.00'],
    ] as const)(
      'builds a stable keyset for %s in both directions',
      async (orderBy, column, cast, value) => {
        const asc = await last(() =>
          repository.findPaymentsPage(
            { ...paymentsFilter, orderBy, direction: 'asc' },
            { value, id: uuid },
            10,
          ),
        );
        const desc = await last(() =>
          repository.findPaymentsPage(
            { ...paymentsFilter, orderBy, direction: 'desc' },
            { value, id: uuid },
            10,
          ),
        );

        expect(asc.sql).toContain(
          `WHERE (r.${column} > ?${cast} OR (r.${column} = ?${cast} AND r.id > ?::uuid))`,
        );
        expect(desc.sql).toContain(`ORDER BY r.${column} DESC, r.id DESC`);
      },
    );

    it('drops attempts as soon as a payment only filter is present', async () => {
      const all = await last(() =>
        repository.findPaymentsPage(paymentsFilter, null, 10),
      );
      const bySource = await last(() =>
        repository.findPaymentsPage(
          { ...paymentsFilter, sources: ['WEB_QR'] },
          null,
          10,
        ),
      );
      const byCashier = await last(() =>
        repository.findPaymentsPage(
          { ...paymentsFilter, cashierId: uuid },
          null,
          10,
        ),
      );

      expect(all.sql).toContain('FROM payment_attempts a');
      expect(bySource.sql).not.toContain('FROM payment_attempts a');
      expect(byCashier.sql).not.toContain('FROM payment_attempts a');
      expect(bySource.sql).toContain('p.source IN (?)');
    });

    it('applies amount, tip, time, weekday, place and search filters to rows and totals alike', async () => {
      const filter = {
        ...paymentsFilter,
        waiterId: uuid,
        tableId: uuid,
        zoneId: uuid,
        minAmount: 100,
        maxAmount: 900,
        hasTip: false,
        timeFromMinute: 60,
        weekdays: [2],
        q: 'mp_1%',
        provider: 'MANUAL',
        status: 'PAID',
      };
      const page = await last(() =>
        repository.findPaymentsPage(filter, null, 10),
      );
      const totals = await last(() =>
        repository.findPaymentStatusTotals(filter),
      );

      for (const query of [page, totals]) {
        expect(query.sql).toContain('ts.assigned_staff_user_id = ?::uuid');
        expect(query.sql).toContain('u.amount >= ?::numeric');
        expect(query.sql).toContain('u.amount <= ?::numeric');
        expect(query.sql).toContain('u.tip = 0');
        expect(query.sql).toContain('EXTRACT(ISODOW FROM');
        expect(query.sql).toContain('u.provider_reference');
        expect(query.sql).toContain('u.provider = ?');
        expect(query.sql).toContain('u.status = ?');
        expect(query.values).toEqual(
          expect.arrayContaining(['%mp!_1!%%', 'MANUAL', 'PAID', 100, 900]),
        );
      }
    });
  });
});

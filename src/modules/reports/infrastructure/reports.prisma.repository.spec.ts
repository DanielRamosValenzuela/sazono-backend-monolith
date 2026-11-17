import type { Prisma } from '@prisma/client';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import { EMPTY_FILTERS } from '../application/report-types';
import { ReportsPrismaRepository } from './reports.prisma.repository';

describe('ReportsPrismaRepository.findHierarchyLines', () => {
  const queryRawMock = jest.fn();
  const repository = new ReportsPrismaRepository({
    $queryRaw: queryRawMock,
  } as unknown as PrismaService);
  const start = new Date('2026-07-14T04:00:00.000Z');
  const end = new Date('2026-07-16T04:00:00.000Z');

  async function run(includeModifiers: boolean): Promise<Prisma.Sql> {
    queryRawMock.mockResolvedValue([]);
    await repository.findHierarchyLines({
      ...EMPTY_FILTERS,
      branchId: '11111111-1111-4111-8111-111111111111',
      start,
      end,
      timeZone: 'America/Santiago',
      cashierId: null,
      methods: [],
      includeModifiers,
    });

    return queryRawMock.mock.calls[
      queryRawMock.mock.calls.length - 1
    ][0] as Prisma.Sql;
  }

  beforeEach(() => {
    queryRawMock.mockReset();
  });

  it('counts the price snapshot as is when modifiers are included, because it already holds them', async () => {
    const query = await run(true);

    expect(query.sql).toContain('SUM(oi.price_snapshot * oi.quantity)');
    expect(query.sql).not.toContain('mods.delta) * oi.quantity');
  });

  it('subtracts the modifier deltas per unit when modifiers are excluded', async () => {
    const query = await run(false);

    expect(query.sql).toContain(
      'SUM((oi.price_snapshot - mods.delta) * oi.quantity)',
    );
  });

  it('attributes the sale with MAX(paid_at) of PAID payments over a half open range', async () => {
    const query = await run(true);

    expect(query.sql).toContain("lp.status = 'PAID'");
    expect(query.sql).toContain('SELECT MAX(lp.paid_at)');
    expect(query.sql).toContain('eff.closed_at >= ?');
    expect(query.sql).toContain('eff.closed_at < ?');
    expect(query.values).toEqual(
      expect.arrayContaining([
        '11111111-1111-4111-8111-111111111111',
        start,
        end,
      ]),
    );
  });

  it('only sells non cancelled items of charged orders and reports cancelled units apart', async () => {
    const query = await run(true);

    expect(query.sql).toContain("oi.status::text <> 'CANCELLED'");
    expect(query.sql).toContain("oi.status::text = 'CANCELLED'");
    expect(query.values).toEqual(
      expect.arrayContaining([
        'CONFIRMED',
        'ROUTED',
        'IN_PREPARATION',
        'PARTIALLY_READY',
        'READY',
        'DELIVERED',
      ]),
    );
    expect(query.values).not.toContain('AWAITING_PAYMENT');
  });

  it('groups by the snapshot path, never by menu ids', async () => {
    const query = await run(true);

    expect(query.sql).toContain(
      'GROUP BY oi.category_path_snapshot, oi.name_snapshot, ps.name',
    );
    expect(query.sql).not.toContain('menu_item_id');
    expect(query.sql).not.toContain('menu_category_id');
  });

  it('keeps every user supplied value as a bound parameter', async () => {
    const query = await run(true);

    expect(query.sql).not.toContain('11111111-1111');
    expect(query.sql).not.toContain('2026-07');
  });
});

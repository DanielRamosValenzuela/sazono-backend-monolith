import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import { isDraftRunDue } from '../infrastructure/platform-statements.scheduler';
import { PlatformStatementsService } from './platform-statements.service';

const RESTAURANT = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Bistro',
  legalName: 'Bistro SpA',
  taxId: '76.123.456-7',
  timezone: 'America/Santiago',
  platformFeeBps: 100,
};
const BRANCH = { id: 'branch-1', name: 'Centro', restaurantId: RESTAURANT.id };

function build(options: {
  payments?: object[];
  refunds?: object[];
  previous?: object[];
  stored?: object[];
}) {
  const queryRaw = jest.fn();
  queryRaw
    .mockResolvedValueOnce(options.payments ?? [])
    .mockResolvedValueOnce(options.refunds ?? [])
    .mockResolvedValue([]);
  const prisma = {
    restaurant: {
      findMany: jest
        .fn()
        .mockResolvedValue([{ ...RESTAURANT, status: 'ACTIVE' }]),
      findUnique: jest.fn().mockResolvedValue(RESTAURANT),
    },
    branch: { findMany: jest.fn().mockResolvedValue([BRANCH]) },
    platformFeeStatement: {
      findMany: jest
        .fn()
        .mockResolvedValueOnce(options.stored ?? [])
        .mockResolvedValue(options.previous ?? []),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    $queryRaw: queryRaw,
    $executeRaw: jest.fn().mockResolvedValue(1),
  };

  return {
    prisma,
    service: new PlatformStatementsService(prisma as unknown as PrismaService),
  };
}

function stored(overrides: Record<string, unknown>) {
  return {
    id: 'st-1',
    restaurantId: RESTAURANT.id,
    grossSales: new Prisma.Decimal(500000),
    tipsTotal: new Prisma.Decimal(40000),
    discounts: new Prisma.Decimal(0),
    refundsTotal: new Prisma.Decimal(0),
    carryOverIn: new Prisma.Decimal(0),
    netSales: new Prisma.Decimal(500000),
    feeBps: 100,
    feeAmount: new Prisma.Decimal(5000),
    status: 'ISSUED',
    breakdown: {
      branches: [
        {
          branchId: 'branch-1',
          name: 'Centro',
          grossSales: '500000.00',
          tipsTotal: '40000.00',
          refunds: '0.00',
          netSales: '500000.00',
        },
      ],
      days: [],
      methods: [],
    },
    notes: null,
    issuedAt: new Date('2026-11-01T10:00:00Z'),
    paidAt: null,
    ...overrides,
  };
}

describe('PlatformStatementsService', () => {
  it('computes a live DRAFT row with fee and totals', async () => {
    const { service } = build({
      payments: [{ key: 'branch-1', gross: '1000000', tips: '80000' }],
      refunds: [{ key: 'branch-1', refunds: '200000' }],
    });

    const result = await service.list('2026-10');

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      status: 'DRAFT',
      frozen: false,
      grossSales: '1000000.00',
      tipsTotal: '80000.00',
      refunds: '200000.00',
      netSales: '800000.00',
      feeAmount: '8000.00',
      branches: [{ branchId: 'branch-1', netSales: '800000.00' }],
    });
    expect(result.totals.feeAmount).toBe('8000.00');
  });

  it('counts discounts of paid bills without payments (courtesy)', async () => {
    const { service, prisma } = build({
      payments: [{ key: 'branch-1', gross: '1000000', tips: '0' }],
    });
    prisma.$queryRaw
      .mockReset()
      .mockResolvedValueOnce([{ key: 'branch-1', gross: '1000000', tips: '0' }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ key: 'branch-1', discounts: '7000' }])
      .mockResolvedValue([]);

    const result = await service.list('2026-10');
    const sql = (prisma.$queryRaw.mock.calls[2][0] as Prisma.Sql).sql;

    expect(sql).toContain('COUNT(p.id) = 0');
    expect(sql).toContain('b.updated_at');
    expect(result.rows[0].discounts).toBe('7000.00');
  });

  it('carries a negative previous month (live) into this month', async () => {
    const { service, prisma } = build({
      payments: [{ key: 'branch-1', gross: '100000', tips: '0' }],
      refunds: [],
    });
    prisma.$queryRaw
      .mockReset()
      .mockResolvedValueOnce([{ key: 'branch-1', gross: '100000', tips: '0' }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ key: 'branch-1', gross: '10000', tips: '0' }])
      .mockResolvedValueOnce([{ key: 'branch-1', refunds: '30000' }])
      .mockResolvedValue([]);

    const result = await service.list('2026-10');

    expect(result.rows[0].carryOver).toBe('-20000.00');
    expect(result.rows[0].netSales).toBe('80000.00');
    expect(result.rows[0].feeAmount).toBe('800.00');
  });

  it('chains carry-over through an unfrozen previous month', async () => {
    const { service, prisma } = build({});
    prisma.$queryRaw
      .mockReset()
      .mockResolvedValueOnce([{ key: 'branch-1', gross: '100000', tips: '0' }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ key: 'branch-1', gross: '10000', tips: '0' }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ key: 'branch-1', refunds: '50000' }])
      .mockResolvedValue([]);

    const result = await service.list('2026-10');

    expect(result.rows[0].carryOver).toBe('-40000.00');
    expect(result.rows[0].netSales).toBe('60000.00');
  });

  it('includes inactive restaurants with sales when creating drafts', async () => {
    const { service, prisma } = build({});
    prisma.restaurant.findMany
      .mockReset()
      .mockResolvedValueOnce([{ ...RESTAURANT, status: 'SUSPENDED' }])
      .mockResolvedValueOnce([{ id: RESTAURANT.id }]);

    await service.createDrafts('2026-10');

    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
    const where = prisma.restaurant.findMany.mock.calls[1][0].where;
    expect(where.branches.some.OR).toHaveLength(2);
  });

  it('skips inactive restaurants without activity', async () => {
    const { service, prisma } = build({});
    prisma.restaurant.findMany
      .mockReset()
      .mockResolvedValueOnce([{ ...RESTAURANT, status: 'SUSPENDED' }])
      .mockResolvedValueOnce([]);

    await service.createDrafts('2026-10');

    expect(prisma.$executeRaw).not.toHaveBeenCalled();
  });

  it('returns the frozen row for ISSUED statements without querying figures', async () => {
    const { service, prisma } = build({ stored: [stored({})] });

    const result = await service.list('2026-10');

    expect(result.rows[0]).toMatchObject({
      status: 'ISSUED',
      frozen: true,
      feeAmount: '5000.00',
    });
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('rejects malformed periods', async () => {
    const { service } = build({});

    await expect(service.list('2026-13')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('refuses to finalize a month that has not ended', async () => {
    const { service } = build({});
    const next = new Date();
    const period = service.currentPeriod(next);

    await expect(service.finalize(period)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('finalizes idempotently counting only inserted/updated rows', async () => {
    const { service, prisma } = build({});
    prisma.$executeRaw.mockResolvedValueOnce(0);

    const result = await service.finalize('2020-01');

    expect(result).toEqual({
      period: '2020-01',
      finalized: 0,
      alreadyFrozen: 1,
    });
    const sql = (prisma.$executeRaw.mock.calls[0][0] as Prisma.Sql).sql;
    expect(sql).toContain('ON CONFLICT (restaurant_id, period_month)');
    expect(sql).toContain("WHERE platform_fee_statements.status = 'DRAFT'");
  });

  it('creates drafts with ON CONFLICT DO NOTHING', async () => {
    const { service, prisma } = build({});

    await service.createDrafts('2026-10');

    const sql = (prisma.$executeRaw.mock.calls[0][0] as Prisma.Sql).sql;
    expect(sql).toContain('DO NOTHING');
  });

  describe('updateStatus', () => {
    it('marks ISSUED as PAID', async () => {
      const { service, prisma } = build({});
      prisma.platformFeeStatement.findUnique.mockResolvedValue(stored({}));
      prisma.platformFeeStatement.update.mockResolvedValue(
        stored({ status: 'PAID', paidAt: new Date() }),
      );

      const row = await service.updateStatus(
        RESTAURANT.id,
        '2026-10',
        'PAID',
        undefined,
      );

      expect(row.status).toBe('PAID');
      expect(prisma.platformFeeStatement.update).toHaveBeenCalled();
    });

    it('rejects invalid transitions', async () => {
      const { service, prisma } = build({});
      prisma.platformFeeStatement.findUnique.mockResolvedValue(
        stored({ status: 'VOID' }),
      );

      await expect(
        service.updateStatus(RESTAURANT.id, '2026-10', 'PAID', undefined),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('requires notes to waive', async () => {
      const { service, prisma } = build({});
      prisma.platformFeeStatement.findUnique.mockResolvedValue(stored({}));

      await expect(
        service.updateStatus(RESTAURANT.id, '2026-10', 'WAIVED', ' '),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('404s when nothing was issued', async () => {
      const { service, prisma } = build({});
      prisma.platformFeeStatement.findUnique.mockResolvedValue(null);

      await expect(
        service.updateStatus(RESTAURANT.id, '2026-10', 'PAID', undefined),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  it('exports CSV with BOM, separator and Spanish headers', async () => {
    const { service } = build({
      payments: [{ key: 'branch-1', gross: '1000000', tips: '0' }],
    });
    const download = await service.exportCsv('2026-10');
    let text = '';

    for await (const chunk of download.stream) {
      text += String(chunk);
    }

    expect(text.charCodeAt(0)).toBe(0xfeff);
    expect(text).toContain(
      'Periodo;Restaurante;RUT/Razon social;Sucursales;Ventas brutas;Propinas;Descuentos;Reembolsos;Arrastre;Ventas netas;Comision;Estado',
    );
    expect(text).toContain(
      '2026-10;Bistro;76.123.456-7 - Bistro SpA;Centro;1000000;0;0;0;0;1000000;10000;Borrador',
    );
    expect(download.filename).toBe('estado-de-cuenta-2026-10.csv');
  });
});

describe('isDraftRunDue', () => {
  it('is due on day 1 after 03:00 Santiago for the previous month', () => {
    expect(isDraftRunDue(new Date('2026-11-01T07:00:00Z'), null)).toEqual({
      due: true,
      period: '2026-10',
    });
  });

  it('is not due before 03:00 local, mid-month or when already run', () => {
    expect(isDraftRunDue(new Date('2026-11-01T05:00:00Z'), null).due).toBe(
      false,
    );
    expect(isDraftRunDue(new Date('2026-11-15T12:00:00Z'), null).due).toBe(
      false,
    );
    expect(isDraftRunDue(new Date('2026-11-01T07:00:00Z'), '2026-10').due).toBe(
      false,
    );
  });
});

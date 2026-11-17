import { BadRequestException } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { LoginProfileType } from '../../auth/dto/login.dto';
import type { BranchAnalyticsPrismaRepository } from '../infrastructure/prisma/branch-analytics.prisma.repository';
import type { BranchAccessService } from '../../../common/branch-access/branch-access.service';
import { GetBranchSummaryService } from './get-branch-summary.service';

describe('GetBranchSummaryService', () => {
  const countTablesMock = jest.fn();
  const countOccupiedTablesMock = jest.fn();
  const countOpenSessionsMock = jest.fn();
  const findPaidPaymentsInRangeMock = jest.fn();
  const groupOrdersByStatusInRangeMock = jest.fn();
  const findTopItemsInRangeMock = jest.fn();
  const findBranchTimezoneMock = jest.fn();

  const repository = {
    countTables: countTablesMock,
    countOccupiedTables: countOccupiedTablesMock,
    countOpenSessions: countOpenSessionsMock,
    findPaidPaymentsInRange: findPaidPaymentsInRangeMock,
    groupOrdersByStatusInRange: groupOrdersByStatusInRangeMock,
    findTopItemsInRange: findTopItemsInRangeMock,
    findBranchTimezone: findBranchTimezoneMock,
  } as unknown as BranchAnalyticsPrismaRepository;

  const ensureAccessMock = jest.fn();
  const BranchAccessService = {
    ensureAccess: ensureAccessMock,
  } as unknown as BranchAccessService;

  const authUser = {
    sub: 'auth-1',
    profileType: LoginProfileType.STAFF,
    profileId: 'staff-1',
    restaurantId: 'restaurant-1',
  };

  let service: GetBranchSummaryService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new GetBranchSummaryService(BranchAccessService, repository);

    ensureAccessMock.mockResolvedValue({
      staffUserId: 'staff-1',
      branchId: 'branch-1',
      restaurantId: 'restaurant-1',
      roles: [Role.ADMIN],
    });
    countTablesMock.mockResolvedValue(10);
    countOccupiedTablesMock.mockResolvedValue(3);
    countOpenSessionsMock.mockResolvedValue(3);
    findPaidPaymentsInRangeMock.mockResolvedValue([]);
    groupOrdersByStatusInRangeMock.mockResolvedValue([]);
    findTopItemsInRangeMock.mockResolvedValue([]);
    findBranchTimezoneMock.mockResolvedValue('America/Santiago');
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('uses independent default windows when no range is given (today / 7 days / 30 days)', async () => {
    await service.execute(authUser, 'branch-1', {});

    expect(findPaidPaymentsInRangeMock).toHaveBeenCalledTimes(2);
    const [todayCall, seriesCall] = findPaidPaymentsInRangeMock.mock.calls;
    const todaySpanMs =
      (todayCall[2] as Date).getTime() - (todayCall[1] as Date).getTime();
    expect(todaySpanMs).toBeLessThan(24 * 60 * 60 * 1000);

    const seriesSpanDays =
      Math.floor(
        ((seriesCall[2] as Date).getTime() -
          (seriesCall[1] as Date).getTime()) /
          (24 * 60 * 60 * 1000),
      ) + 1;
    expect(seriesSpanDays).toBe(7);

    const [ordersStart, ordersEnd] =
      groupOrdersByStatusInRangeMock.mock.calls[0].slice(1);
    const ordersSpanMs =
      (ordersEnd as Date).getTime() - (ordersStart as Date).getTime();
    expect(ordersSpanMs).toBeLessThan(24 * 60 * 60 * 1000);

    const [topStart, topEnd] = findTopItemsInRangeMock.mock.calls[0].slice(1);
    const topSpanDays =
      Math.floor(
        ((topEnd as Date).getTime() - (topStart as Date).getTime()) /
          (24 * 60 * 60 * 1000),
      ) + 1;
    expect(topSpanDays).toBe(30);
  });

  it('applies the same custom range to the series, orders-by-status and top items in the restaurant timezone', async () => {
    await service.execute(authUser, 'branch-1', {
      from: '2026-07-01',
      to: '2026-07-03',
    });

    const seriesCall = findPaidPaymentsInRangeMock.mock.calls[1];
    const ordersCall = groupOrdersByStatusInRangeMock.mock.calls[0];
    const topCall = findTopItemsInRangeMock.mock.calls[0];

    for (const call of [seriesCall, ordersCall, topCall]) {
      expect((call[1] as Date).toISOString()).toBe('2026-07-01T04:00:00.000Z');
      expect((call[2] as Date).toISOString()).toBe('2026-07-04T03:59:59.999Z');
    }
  });

  it('computes today in the restaurant timezone, not in the server timezone', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-16T03:30:00.000Z'));

    await service.execute(authUser, 'branch-1', {});

    const todayCall = findPaidPaymentsInRangeMock.mock.calls[0];

    expect((todayCall[1] as Date).toISOString()).toBe(
      '2026-07-15T04:00:00.000Z',
    );
    expect((todayCall[2] as Date).toISOString()).toBe(
      '2026-07-16T03:59:59.999Z',
    );
  });

  it('keeps a 23:30 Santiago sale on its own day in the daily series', async () => {
    findPaidPaymentsInRangeMock.mockResolvedValue([
      {
        amount: new Prisma.Decimal(5000),
        tipAmount: new Prisma.Decimal(0),
        paidAt: new Date('2026-07-03T03:30:00.000Z'),
        createdAt: new Date('2026-07-03T03:30:00.000Z'),
      },
    ]);

    const result = await service.execute(authUser, 'branch-1', {
      from: '2026-07-01',
      to: '2026-07-03',
    });

    expect(result.dailySeries).toEqual([
      { date: '2026-07-01', amount: '0.00', count: 0 },
      { date: '2026-07-02', amount: '5000.00', count: 1 },
      { date: '2026-07-03', amount: '0.00', count: 0 },
    ]);
  });

  it('excludes the tip from the daily series and from today revenue', async () => {
    findPaidPaymentsInRangeMock.mockResolvedValue([
      {
        amount: new Prisma.Decimal(5500),
        tipAmount: new Prisma.Decimal(500),
        paidAt: new Date(),
        createdAt: new Date(),
      },
    ]);

    const result = await service.execute(authUser, 'branch-1', {});

    expect(result.todayRevenue).toBe('5000.00');
    expect(result.dailySeries.reduce((s, d) => s + Number(d.amount), 0)).toBe(
      5000,
    );
  });

  it('builds a dailySeries entry per day of a custom range, defaulting to zero', async () => {
    const result = await service.execute(authUser, 'branch-1', {
      from: '2026-07-01',
      to: '2026-07-03',
    });

    expect(result.dailySeries).toEqual([
      { date: '2026-07-01', amount: '0.00', count: 0 },
      { date: '2026-07-02', amount: '0.00', count: 0 },
      { date: '2026-07-03', amount: '0.00', count: 0 },
    ]);
  });

  it('keeps todayRevenue independent from a custom past range', async () => {
    findPaidPaymentsInRangeMock.mockImplementation(
      (_branchId: string, start: Date, end: Date) => {
        const spanMs = end.getTime() - start.getTime();
        const isTodayCall = spanMs < 24 * 60 * 60 * 1000;
        if (isTodayCall) {
          return Promise.resolve([
            {
              amount: new Prisma.Decimal(5000),
              tipAmount: new Prisma.Decimal(0),
              paidAt: new Date(),
              createdAt: new Date(),
            },
          ]);
        }
        return Promise.resolve([]);
      },
    );

    const result = await service.execute(authUser, 'branch-1', {
      from: '2020-01-01',
      to: '2020-01-02',
    });

    expect(result.todayRevenue).toBe('5000.00');
    expect(result.todayPaymentsCount).toBe(1);
  });

  it('rejects "from" without "to"', async () => {
    await expect(
      service.execute(authUser, 'branch-1', { from: '2026-07-01' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a range where "from" is after "to"', async () => {
    await expect(
      service.execute(authUser, 'branch-1', {
        from: '2026-07-10',
        to: '2026-07-01',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a range spanning more than 92 days', async () => {
    await expect(
      service.execute(authUser, 'branch-1', {
        from: '2026-01-01',
        to: '2026-12-31',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

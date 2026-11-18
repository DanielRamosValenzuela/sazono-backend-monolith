import { BadRequestException } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { LoginProfileType } from '../../auth/dto/login.dto';
import type { ReportsInsightsPrismaRepository } from '../../reports/infrastructure/reports-insights.prisma.repository';
import type { BranchAnalyticsPrismaRepository } from '../infrastructure/prisma/branch-analytics.prisma.repository';
import type { BranchAccessService } from '../../../common/branch-access/branch-access.service';
import { GetBranchSummaryService } from './get-branch-summary.service';

describe('GetBranchSummaryService', () => {
  const countTablesMock = jest.fn();
  const countOccupiedTablesMock = jest.fn();
  const countOpenSessionsMock = jest.fn();
  const findPeriodBucketsMock = jest.fn();
  const groupOrdersByStatusInRangeMock = jest.fn();
  const findTopItemsInRangeMock = jest.fn();
  const findBranchTimezoneMock = jest.fn();

  const repository = {
    countTables: countTablesMock,
    countOccupiedTables: countOccupiedTablesMock,
    countOpenSessions: countOpenSessionsMock,
    groupOrdersByStatusInRange: groupOrdersByStatusInRangeMock,
    findTopItemsInRange: findTopItemsInRangeMock,
    findBranchTimezone: findBranchTimezoneMock,
  } as unknown as BranchAnalyticsPrismaRepository;

  const insightsRepository = {
    findPeriodBuckets: findPeriodBucketsMock,
  } as unknown as ReportsInsightsPrismaRepository;

  const ensureAccessMock = jest.fn();
  const branchAccessService = {
    ensureAccess: ensureAccessMock,
  } as unknown as BranchAccessService;

  const authUser = {
    sub: 'auth-1',
    profileType: LoginProfileType.STAFF,
    profileId: 'staff-1',
    restaurantId: 'restaurant-1',
  };

  const bucket = (
    key: string,
    bills: number,
    amount: number,
    refunded = 0,
  ) => ({
    bucket: key,
    bills,
    guests: 0,
    amount: new Prisma.Decimal(amount),
    tip: new Prisma.Decimal(0),
    refunded: new Prisma.Decimal(refunded),
  });

  let service: GetBranchSummaryService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new GetBranchSummaryService(
      branchAccessService,
      repository,
      insightsRepository,
    );

    ensureAccessMock.mockResolvedValue({
      staffUserId: 'staff-1',
      branchId: 'branch-1',
      restaurantId: 'restaurant-1',
      roles: [Role.ADMIN],
    });
    countTablesMock.mockResolvedValue(10);
    countOccupiedTablesMock.mockResolvedValue(3);
    countOpenSessionsMock.mockResolvedValue(3);
    findPeriodBucketsMock.mockResolvedValue([]);
    groupOrdersByStatusInRangeMock.mockResolvedValue([]);
    findTopItemsInRangeMock.mockResolvedValue([]);
    findBranchTimezoneMock.mockResolvedValue('America/Santiago');
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('uses independent default windows (7 day series including today, today orders, 30 day top items)', async () => {
    await service.execute(authUser, 'branch-1', {});

    expect(findPeriodBucketsMock).toHaveBeenCalledTimes(1);
    const [filter, grain] = findPeriodBucketsMock.mock.calls[0] as [
      { start: Date; end: Date; timeZone: string },
      string,
    ];
    expect(grain).toBe('day');
    expect(filter.timeZone).toBe('America/Santiago');
    expect(
      Math.round(
        (filter.end.getTime() - filter.start.getTime()) / (24 * 3600 * 1000),
      ),
    ).toBe(7);

    const [ordersStart, ordersEnd] =
      groupOrdersByStatusInRangeMock.mock.calls[0].slice(1);
    expect(
      (ordersEnd as Date).getTime() - (ordersStart as Date).getTime(),
    ).toBeLessThan(24 * 60 * 60 * 1000);

    const [topStart, topEnd] = findTopItemsInRangeMock.mock.calls[0].slice(1);
    expect(
      Math.floor(
        ((topEnd as Date).getTime() - (topStart as Date).getTime()) /
          (24 * 60 * 60 * 1000),
      ) + 1,
    ).toBe(30);
  });

  it('applies the same custom range to the series, orders-by-status and top items in the restaurant timezone', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-16T18:00:00.000Z'));

    await service.execute(authUser, 'branch-1', {
      from: '2026-07-01',
      to: '2026-07-03',
    });

    const [seriesFilter] = findPeriodBucketsMock.mock.calls[0] as [
      { start: Date; end: Date },
    ];
    expect(seriesFilter.start.toISOString()).toBe('2026-07-01T04:00:00.000Z');
    expect(seriesFilter.end.toISOString()).toBe('2026-07-04T04:00:00.000Z');

    for (const call of [
      groupOrdersByStatusInRangeMock.mock.calls[0],
      findTopItemsInRangeMock.mock.calls[0],
    ]) {
      expect((call[1] as Date).toISOString()).toBe('2026-07-01T04:00:00.000Z');
      expect((call[2] as Date).toISOString()).toBe('2026-07-04T03:59:59.999Z');
    }
  });

  it('computes today in the restaurant timezone, not in the server timezone', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-16T03:30:00.000Z'));

    await service.execute(authUser, 'branch-1', {
      from: '2026-07-01',
      to: '2026-07-03',
    });

    const [todayFilter] = findPeriodBucketsMock.mock.calls[1] as [
      { start: Date; end: Date },
    ];
    expect(todayFilter.start.toISOString()).toBe('2026-07-15T04:00:00.000Z');
    expect(todayFilter.end.toISOString()).toBe('2026-07-16T04:00:00.000Z');
  });

  it('reads today from the series buckets when the series covers today', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-16T18:00:00.000Z'));
    findPeriodBucketsMock.mockResolvedValue([
      bucket('2026-07-15', 1, 4000),
      bucket('2026-07-16', 2, 12000, 2000),
    ]);

    const result = await service.execute(authUser, 'branch-1', {});

    expect(findPeriodBucketsMock).toHaveBeenCalledTimes(1);
    expect(result.todayRevenue).toBe('10000.00');
    expect(result.todayRefunded).toBe('2000.00');
    expect(result.todayPaymentsCount).toBe(2);
    expect(result.averageTicket).toBe('5000.00');
    expect(result.dailySeries.find((day) => day.date === '2026-07-16')).toEqual(
      {
        date: '2026-07-16',
        amount: '10000.00',
        count: 2,
        refunded: '2000.00',
      },
    );
  });

  it('attributes a split bill to the day of its last payment exactly like the reports', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-16T18:00:00.000Z'));
    findPeriodBucketsMock.mockResolvedValue([bucket('2026-07-16', 1, 12000)]);

    const result = await service.execute(authUser, 'branch-1', {
      from: '2026-07-15',
      to: '2026-07-16',
    });

    expect(result.dailySeries).toEqual([
      { date: '2026-07-15', amount: '0.00', count: 0, refunded: '0.00' },
      { date: '2026-07-16', amount: '12000.00', count: 1, refunded: '0.00' },
    ]);
    expect(result.todayRevenue).toBe('12000.00');
  });

  it('keeps todayRevenue independent from a custom past range', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-16T18:00:00.000Z'));
    findPeriodBucketsMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([bucket('2026-07-16', 1, 5000)]);

    const result = await service.execute(authUser, 'branch-1', {
      from: '2020-01-01',
      to: '2020-01-02',
    });

    expect(findPeriodBucketsMock).toHaveBeenCalledTimes(2);
    expect(result.todayRevenue).toBe('5000.00');
    expect(result.todayPaymentsCount).toBe(1);
    expect(result.dailySeries).toHaveLength(2);
  });

  it('does not show a negative average ticket when refunds exceed the sales of the day', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-16T18:00:00.000Z'));
    findPeriodBucketsMock.mockResolvedValue([
      bucket('2026-07-16', 1, 5000, 8000),
    ]);

    const result = await service.execute(authUser, 'branch-1', {});

    expect(result.todayRevenue).toBe('-3000.00');
    expect(result.averageTicket).toBe('0.00');
  });

  it('builds a dailySeries entry per day of a custom range, defaulting to zero', async () => {
    const result = await service.execute(authUser, 'branch-1', {
      from: '2026-07-01',
      to: '2026-07-03',
    });

    expect(result.dailySeries).toEqual([
      { date: '2026-07-01', amount: '0.00', count: 0, refunded: '0.00' },
      { date: '2026-07-02', amount: '0.00', count: 0, refunded: '0.00' },
      { date: '2026-07-03', amount: '0.00', count: 0, refunded: '0.00' },
    ]);
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

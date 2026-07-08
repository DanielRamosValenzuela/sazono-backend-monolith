import { BadRequestException } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { LoginProfileType } from '../../auth/dto/login.dto';
import type { BranchAnalyticsPrismaRepository } from '../infrastructure/prisma/branch-analytics.prisma.repository';
import type { AnalyticsBranchAccessService } from './analytics-branch-access.service';
import { GetBranchSummaryService } from './get-branch-summary.service';

describe('GetBranchSummaryService', () => {
  const countTablesMock = jest.fn();
  const countOccupiedTablesMock = jest.fn();
  const countOpenSessionsMock = jest.fn();
  const findPaidPaymentsInRangeMock = jest.fn();
  const groupOrdersByStatusInRangeMock = jest.fn();
  const findTopItemsInRangeMock = jest.fn();

  const repository = {
    countTables: countTablesMock,
    countOccupiedTables: countOccupiedTablesMock,
    countOpenSessions: countOpenSessionsMock,
    findPaidPaymentsInRange: findPaidPaymentsInRangeMock,
    groupOrdersByStatusInRange: groupOrdersByStatusInRangeMock,
    findTopItemsInRange: findTopItemsInRangeMock,
  } as unknown as BranchAnalyticsPrismaRepository;

  const ensureAccessMock = jest.fn();
  const analyticsBranchAccessService = {
    ensureAccess: ensureAccessMock,
  } as unknown as AnalyticsBranchAccessService;

  const authUser = {
    sub: 'auth-1',
    profileType: LoginProfileType.STAFF,
    profileId: 'staff-1',
    restaurantId: 'restaurant-1',
  };

  let service: GetBranchSummaryService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new GetBranchSummaryService(
      analyticsBranchAccessService,
      repository,
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
    findPaidPaymentsInRangeMock.mockResolvedValue([]);
    groupOrdersByStatusInRangeMock.mockResolvedValue([]);
    findTopItemsInRangeMock.mockResolvedValue([]);
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

  function toLocalDateKey(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  it('applies the same custom range to the series, orders-by-status and top items', async () => {
    await service.execute(authUser, 'branch-1', {
      from: '2026-07-01',
      to: '2026-07-03',
    });

    const seriesCall = findPaidPaymentsInRangeMock.mock.calls[1];
    const ordersCall = groupOrdersByStatusInRangeMock.mock.calls[0];
    const topCall = findTopItemsInRangeMock.mock.calls[0];

    for (const call of [seriesCall, ordersCall, topCall]) {
      const start = call[1] as Date;
      const end = call[2] as Date;
      expect(toLocalDateKey(start)).toBe('2026-07-01');
      expect(toLocalDateKey(end)).toBe('2026-07-03');
    }
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

import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import type { BranchAccessService } from '../../../common/branch-access/branch-access.service';
import { LoginProfileType } from '../../auth/dto/login.dto';
import type { ReportsPrismaRepository } from '../infrastructure/reports.prisma.repository';
import { ReportScopeService } from './report-scope.service';
import { EMPTY_FILTERS } from './report-types';

const UUID = '11111111-1111-4111-8111-111111111111';
const OTHER = '33333333-3333-4333-8333-333333333333';

describe('ReportScopeService filters and branch access', () => {
  let currentRoles: Role[] = [];
  const findBranchTimezoneMock = jest.fn();
  const branchAccessService = {
    ensureAccess: jest.fn(
      (_authUser: unknown, _branchId: string, allowed: Role[]) => {
        if (!currentRoles.some((role) => allowed.includes(role))) {
          return Promise.reject(new ForbiddenException());
        }

        return Promise.resolve({
          staffUserId: 'staff-1',
          restaurantId: 'restaurant-1',
          branchId: 'branch-1',
          roles: currentRoles,
        });
      },
    ),
  } as unknown as BranchAccessService;
  const service = new ReportScopeService(branchAccessService, {
    findBranchTimezone: findBranchTimezoneMock,
  } as unknown as ReportsPrismaRepository);
  const authUser = {
    sub: 'auth-1',
    profileType: LoginProfileType.STAFF,
    profileId: 'staff-1',
    restaurantId: 'restaurant-1',
  };
  const range = { from: '2026-11-01', to: '2026-11-03' };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
    findBranchTimezoneMock.mockResolvedValue('America/Santiago');
    currentRoles = [Role.ADMIN];
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('returns the empty filter set when no new filter is given, keeping old callers unchanged', async () => {
    const scope = await service.resolve(authUser, 'branch-1', range, {
      forCsv: false,
    });

    expect(scope.filters).toEqual(EMPTY_FILTERS);
  });

  it.each([Role.ADMIN, Role.SUPERVISOR])(
    'parses every filter for %s',
    async (role) => {
      currentRoles = [role];

      const scope = await service.resolve(
        authUser,
        'branch-1',
        {
          ...range,
          waiterId: UUID,
          source: 'WAITER',
          status: 'MIXED',
          minAmount: 1000,
          timeFrom: '22:00',
          timeTo: '02:00',
          weekdays: '5,6',
          q: 'caro',
        },
        { forCsv: false },
      );

      expect(scope.filters).toMatchObject({
        waiterId: UUID,
        sources: ['WAITER'],
        billStatuses: ['MIXED'],
        minAmount: 1000,
        timeFromMinute: 1320,
        timeToMinute: 120,
        weekdays: [5, 6],
        q: 'caro',
      });
    },
  );

  it.each([
    ['waiterId', { waiterId: 'nope' }],
    ['source', { source: 'POS' }],
    ['status', { status: 'PAID' }],
    ['amount range', { minAmount: 10, maxAmount: 5 }],
    ['timeFrom', { timeFrom: '25:00' }],
    ['weekdays', { weekdays: '9' }],
    ['categoryPath', { categoryPath: 'a>>b' }],
  ])('rejects an invalid %s with 400 for every role', async (_name, extra) => {
    for (const role of [Role.ADMIN, Role.CASHIER]) {
      currentRoles = [role];

      await expect(
        service.resolve(
          authUser,
          'branch-1',
          { ...range, ...extra },
          { forCsv: false },
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    }
  });

  it('lets a CASHIER narrow the filters but never widen the forced scope', async () => {
    currentRoles = [Role.CASHIER];
    jest.useFakeTimers().setSystemTime(new Date('2026-07-16T03:30:00.000Z'));

    const scope = await service.resolve(
      authUser,
      'branch-1',
      {
        from: '2020-01-01',
        to: '2026-12-31',
        cashierId: OTHER,
        waiterId: UUID,
        source: 'CASHIER',
        q: 'mesa',
      },
      { forCsv: false },
    );

    expect(scope).toMatchObject({
      from: '2026-07-15',
      to: '2026-07-15',
      cashierId: 'staff-1',
      cashierScoped: true,
    });
    expect(scope.filters).toMatchObject({
      waiterId: UUID,
      sources: ['CASHIER'],
      q: 'mesa',
    });
  });

  it.each([Role.WAITER, Role.KITCHEN, Role.BAR])(
    'rejects %s with 403 even with valid filters',
    async (role) => {
      currentRoles = [role];

      await expect(
        service.resolve(
          authUser,
          'branch-1',
          { ...range, waiterId: UUID },
          { forCsv: false },
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      await expect(
        service.resolveAccess(authUser, 'branch-1'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    },
  );

  describe('resolveAccess', () => {
    it('flags a CASHIER as scoped and exposes the restaurant day window', async () => {
      currentRoles = [Role.CASHIER];
      jest.useFakeTimers().setSystemTime(new Date('2026-07-16T03:30:00.000Z'));

      const access = await service.resolveAccess(authUser, 'branch-1');

      expect(access).toMatchObject({
        timeZone: 'America/Santiago',
        cashierScoped: true,
        staffUserId: 'staff-1',
      });
      expect(access.todayStart.toISOString()).toBe('2026-07-15T04:00:00.000Z');
      expect(access.todayEnd.toISOString()).toBe('2026-07-16T04:00:00.000Z');
    });

    it.each([Role.ADMIN, Role.SUPERVISOR])(
      'does not scope %s',
      async (role) => {
        currentRoles = [role];

        await expect(
          service.resolveAccess(authUser, 'branch-1'),
        ).resolves.toMatchObject({ cashierScoped: false });
      },
    );

    it('answers 404 for an unknown branch', async () => {
      findBranchTimezoneMock.mockResolvedValue(null);

      await expect(
        service.resolveAccess(authUser, 'branch-1'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});

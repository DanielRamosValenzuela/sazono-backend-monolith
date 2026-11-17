import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { BranchAccessService } from '../../../common/branch-access/branch-access.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import { LoginProfileType } from '../../auth/dto/login.dto';
import type { ReportsPrismaRepository } from '../infrastructure/reports.prisma.repository';
import { ReportScopeService } from './report-scope.service';

describe('ReportScopeService', () => {
  const staffFindFirstMock = jest.fn();
  const branchAccessService = new BranchAccessService({
    staffUser: { findFirst: staffFindFirstMock },
  } as unknown as PrismaService);
  const findBranchTimezoneMock = jest.fn();
  const service = new ReportScopeService(branchAccessService, {
    findBranchTimezone: findBranchTimezoneMock,
  } as unknown as ReportsPrismaRepository);
  const authUser = {
    sub: 'auth-1',
    profileType: LoginProfileType.STAFF,
    profileId: 'staff-1',
    restaurantId: 'restaurant-1',
  };
  const html = { forCsv: false };

  function mockRoles(...roles: Role[]) {
    staffFindFirstMock.mockResolvedValue({
      id: 'staff-1',
      restaurantId: 'restaurant-1',
      branchRoles: roles.map((role) => ({ role })),
    });
  }

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
    findBranchTimezoneMock.mockResolvedValue('America/Santiago');
    mockRoles(Role.ADMIN);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it.each([Role.WAITER, Role.KITCHEN, Role.BAR])(
    'rejects the %s role with 403',
    async (role) => {
      mockRoles(role);

      await expect(
        service.resolve(
          authUser,
          'branch-1',
          { from: '2026-11-01', to: '2026-11-02' },
          html,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    },
  );

  it.each([Role.ADMIN, Role.SUPERVISOR])(
    'lets %s read any cashier and the requested range',
    async (role) => {
      mockRoles(role);

      const scope = await service.resolve(
        authUser,
        'branch-1',
        {
          from: '2026-11-01',
          to: '2026-11-03',
          cashierId: 'cashier-9',
          method: 'CASH,SIN_CLASIFICAR',
        },
        html,
      );

      expect(scope).toMatchObject({
        from: '2026-11-01',
        to: '2026-11-03',
        cashierId: 'cashier-9',
        methods: ['CASH', 'SIN_CLASIFICAR'],
        cashierScoped: false,
      });
    },
  );

  it('forces a CASHIER to their own id and to today, ignoring the query', async () => {
    mockRoles(Role.CASHIER);
    jest.useFakeTimers().setSystemTime(new Date('2026-07-16T03:30:00.000Z'));

    const scope = await service.resolve(
      authUser,
      'branch-1',
      { from: '2020-01-01', to: '2026-12-31', cashierId: 'someone-else' },
      html,
    );

    expect(scope).toMatchObject({
      from: '2026-07-15',
      to: '2026-07-15',
      cashierId: 'staff-1',
      cashierScoped: true,
    });
    expect(scope.start.toISOString()).toBe('2026-07-15T04:00:00.000Z');
    expect(scope.end.toISOString()).toBe('2026-07-16T04:00:00.000Z');
  });

  it('treats a user with CASHIER and ADMIN roles as full access', async () => {
    mockRoles(Role.CASHIER, Role.ADMIN);

    const scope = await service.resolve(
      authUser,
      'branch-1',
      { from: '2026-11-01', to: '2026-11-01' },
      html,
    );

    expect(scope.cashierScoped).toBe(false);
    expect(scope.cashierId).toBeNull();
  });

  it('builds a half-open range in the restaurant timezone so 23:30 Santiago of the last day is included', async () => {
    const scope = await service.resolve(
      authUser,
      'branch-1',
      { from: '2026-07-14', to: '2026-07-15' },
      html,
    );
    const lateSale = new Date('2026-07-16T03:30:00.000Z');
    const nextDayFirstSale = new Date('2026-07-16T04:00:00.000Z');

    expect(scope.start.toISOString()).toBe('2026-07-14T04:00:00.000Z');
    expect(scope.end.toISOString()).toBe('2026-07-16T04:00:00.000Z');
    expect(lateSale >= scope.start && lateSale < scope.end).toBe(true);
    expect(nextDayFirstSale < scope.end).toBe(false);
  });

  it('uses the summer offset (UTC-3) for dates in daylight saving time', async () => {
    const scope = await service.resolve(
      authUser,
      'branch-1',
      { from: '2026-01-10', to: '2026-01-10' },
      html,
    );

    expect(scope.start.toISOString()).toBe('2026-01-10T03:00:00.000Z');
    expect(scope.end.toISOString()).toBe('2026-01-11T03:00:00.000Z');
  });

  it.each([
    { label: 'missing from and to', query: {} },
    { label: 'missing to', query: { from: '2026-11-01' } },
    { label: 'invalid month', query: { from: '2026-13-01', to: '2026-13-02' } },
    {
      label: 'impossible day',
      query: { from: '2026-02-30', to: '2026-03-01' },
    },
    { label: 'from after to', query: { from: '2026-11-05', to: '2026-11-01' } },
    { label: '367 days', query: { from: '2025-01-01', to: '2026-01-02' } },
  ])('rejects a range with $label', async ({ query }) => {
    await expect(
      service.resolve(authUser, 'branch-1', query, html),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('accepts exactly 366 days for JSON', async () => {
    await expect(
      service.resolve(
        authUser,
        'branch-1',
        { from: '2024-01-01', to: '2024-12-31' },
        html,
      ),
    ).resolves.toBeDefined();
  });

  it('accepts exactly 92 days for CSV and rejects 93', async () => {
    await expect(
      service.resolve(
        authUser,
        'branch-1',
        { from: '2026-01-01', to: '2026-04-02' },
        { forCsv: true },
      ),
    ).resolves.toBeDefined();
    await expect(
      service.resolve(
        authUser,
        'branch-1',
        { from: '2026-01-01', to: '2026-04-03' },
        { forCsv: true },
      ),
    ).rejects.toThrow('92');
  });

  it('rejects unknown payment methods', async () => {
    await expect(
      service.resolve(
        authUser,
        'branch-1',
        { from: '2026-11-01', to: '2026-11-01', method: 'CASH,BITCOIN' },
        html,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

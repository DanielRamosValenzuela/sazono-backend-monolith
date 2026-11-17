import { ForbiddenException } from '@nestjs/common';
import { BranchRoleStatus, Role, StaffUserStatus } from '@prisma/client';
import { LoginProfileType } from '../../modules/auth/dto/login.dto';
import { InMemoryCacheStore } from '../cache/in-memory-cache.store';
import type { PrismaService } from '../prisma/prisma.service';
import {
  BranchAccessService,
  STAFF_ACCESS_CACHE_TTL_MS,
} from './branch-access.service';

describe('BranchAccessService', () => {
  const findFirstMock = jest.fn();
  const prisma = {
    staffUser: { findFirst: findFirstMock },
  } as unknown as PrismaService;

  const authUser = {
    sub: 'auth-1',
    profileType: LoginProfileType.STAFF,
    profileId: 'staff-1',
    restaurantId: 'restaurant-1',
  };

  const staffRow = (branchRoles: Array<{ branchId: string; role: Role }>) => ({
    id: 'staff-1',
    restaurantId: 'restaurant-1',
    status: StaffUserStatus.ACTIVE,
    branchRoles,
  });

  let service: BranchAccessService;

  beforeEach(() => {
    jest.useFakeTimers();
    findFirstMock.mockReset();
    service = new BranchAccessService(prisma, new InMemoryCacheStore());
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('queries every active role of the staff user once and reuses it', async () => {
    findFirstMock.mockResolvedValue(
      staffRow([
        { branchId: 'branch-1', role: Role.ADMIN },
        { branchId: 'branch-2', role: Role.WAITER },
      ]),
    );

    const first = await service.ensureAccess(authUser, 'branch-1', [
      Role.ADMIN,
    ]);
    const second = await service.ensureAccess(authUser, 'branch-2', [
      Role.WAITER,
    ]);

    expect(first).toEqual({
      staffUserId: 'staff-1',
      restaurantId: 'restaurant-1',
      branchId: 'branch-1',
      roles: [Role.ADMIN],
    });
    expect(second.roles).toEqual([Role.WAITER]);
    expect(findFirstMock).toHaveBeenCalledTimes(1);
    expect(findFirstMock).toHaveBeenCalledWith({
      where: {
        id: 'staff-1',
        restaurantId: 'restaurant-1',
        status: StaffUserStatus.ACTIVE,
      },
      include: {
        branchRoles: {
          where: { status: BranchRoleStatus.ACTIVE },
          select: { branchId: true, role: true },
        },
      },
    });
  });

  it('reloads after the ttl and stops granting a revoked role', async () => {
    findFirstMock.mockResolvedValueOnce(
      staffRow([{ branchId: 'branch-1', role: Role.ADMIN }]),
    );
    await service.ensureAccess(authUser, 'branch-1', [Role.ADMIN]);

    findFirstMock.mockResolvedValue(null);
    jest.advanceTimersByTime(STAFF_ACCESS_CACHE_TTL_MS + 1);

    await expect(
      service.ensureAccess(authUser, 'branch-1', [Role.ADMIN]),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(findFirstMock).toHaveBeenCalledTimes(2);
  });

  it('stops granting immediately after invalidateStaff', async () => {
    findFirstMock.mockResolvedValueOnce(
      staffRow([{ branchId: 'branch-1', role: Role.ADMIN }]),
    );
    await service.ensureAccess(authUser, 'branch-1', [Role.ADMIN]);

    findFirstMock.mockResolvedValue(null);
    await service.invalidateStaff('staff-1');

    await expect(
      service.ensureAccess(authUser, 'branch-1', [Role.ADMIN]),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rechecks the database before denying from a cached entry', async () => {
    findFirstMock.mockResolvedValueOnce(
      staffRow([{ branchId: 'branch-1', role: Role.WAITER }]),
    );
    await service.ensureAccess(authUser, 'branch-1', [Role.WAITER]);

    findFirstMock.mockResolvedValue(
      staffRow([
        { branchId: 'branch-1', role: Role.WAITER },
        { branchId: 'branch-2', role: Role.ADMIN },
      ]),
    );

    const context = await service.ensureAccess(authUser, 'branch-2', [
      Role.ADMIN,
    ]);

    expect(context.roles).toEqual([Role.ADMIN]);
    expect(findFirstMock).toHaveBeenCalledTimes(2);
  });

  it('denies without a second query when the first lookup was fresh', async () => {
    findFirstMock.mockResolvedValue(
      staffRow([{ branchId: 'branch-1', role: Role.WAITER }]),
    );

    await expect(
      service.ensureAccess(authUser, 'branch-1', [Role.ADMIN]),
    ).rejects.toThrow('No tienes permisos suficientes sobre esta sucursal.');
    expect(findFirstMock).toHaveBeenCalledTimes(1);
  });

  it('rejects non staff profiles without touching the database', async () => {
    await expect(
      service.ensureAccess(
        { ...authUser, profileType: LoginProfileType.PLATFORM_ADMIN },
        'branch-1',
        [Role.ADMIN],
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(findFirstMock).not.toHaveBeenCalled();
  });

  it('builds the staff context from the same cached entry', async () => {
    findFirstMock.mockResolvedValue(
      staffRow([
        { branchId: 'branch-1', role: Role.ADMIN },
        { branchId: 'branch-2', role: Role.WAITER },
      ]),
    );

    await service.ensureAccess(authUser, 'branch-1', [Role.ADMIN]);
    const context = await service.getStaffContext(authUser);

    expect(findFirstMock).toHaveBeenCalledTimes(1);
    expect(context.staffUserId).toBe('staff-1');
    expect([...context.memberBranchIds]).toEqual(['branch-1', 'branch-2']);
    expect([...context.adminBranchIds]).toEqual(['branch-1']);
  });

  it('rejects the staff context when the user is no longer active', async () => {
    findFirstMock.mockResolvedValue(null);

    await expect(service.getStaffContext(authUser)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('does not reuse a cached entry from another restaurant', async () => {
    findFirstMock.mockResolvedValueOnce(
      staffRow([{ branchId: 'branch-1', role: Role.ADMIN }]),
    );
    await service.ensureAccess(authUser, 'branch-1', [Role.ADMIN]);

    findFirstMock.mockResolvedValue(null);

    await expect(
      service.ensureAccess(
        { ...authUser, restaurantId: 'restaurant-2' },
        'branch-1',
        [Role.ADMIN],
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});

import { BadRequestException, ForbiddenException } from '@nestjs/common';
import {
  BranchRoleStatus,
  Role,
  StaffUserStatus,
  TableSessionOpenedBySource,
  TableSessionStatus,
} from '@prisma/client';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import { AssignTableSessionService } from './assign-table-session.service';
import type { BranchAccessService } from '../../../common/branch-access/branch-access.service';
import { LoginProfileType } from '../../auth/dto/login.dto';

describe('AssignTableSessionService', () => {
  const findUniqueSessionMock = jest.fn();
  const branchSettingsFindUniqueMock = jest.fn();
  const staffUserBranchRoleFindFirstMock = jest.fn();
  const updateSessionMock = jest.fn();
  const prisma = {
    tableSession: {
      findUnique: findUniqueSessionMock,
      update: updateSessionMock,
    },
    branchSettings: {
      findUnique: branchSettingsFindUniqueMock,
    },
    staffUserBranchRole: {
      findFirst: staffUserBranchRoleFindFirstMock,
    },
  } as unknown as PrismaService;

  const ensureAccessMock = jest.fn();
  const branchAccessService = {
    ensureAccess: ensureAccessMock,
  } as unknown as BranchAccessService;

  let service: AssignTableSessionService;

  const authUser = {
    sub: 'auth-1',
    profileType: LoginProfileType.STAFF,
    profileId: 'staff-1',
    restaurantId: 'restaurant-1',
  };

  const existingSession = {
    id: 'session-1',
    tableId: 'table-1',
    branchId: 'branch-1',
    status: TableSessionStatus.OPEN,
    openedBySource: TableSessionOpenedBySource.WAITER,
    openedAt: new Date('2026-07-21T12:00:00.000Z'),
    closeReason: null,
    closedAt: null,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    findUniqueSessionMock.mockResolvedValue(existingSession);
    branchSettingsFindUniqueMock.mockResolvedValue({
      tableAssignmentEnabled: true,
    });
    updateSessionMock.mockResolvedValue({
      ...existingSession,
      assignedStaffUserId: 'staff-1',
    });
    service = new AssignTableSessionService(prisma, branchAccessService);
  });

  it('lets a waiter self-assign the table', async () => {
    ensureAccessMock.mockResolvedValue({
      staffUserId: 'staff-1',
      restaurantId: 'restaurant-1',
      branchId: 'branch-1',
      roles: [Role.WAITER],
    });

    const result = await service.execute(authUser, 'session-1', {});

    expect(updateSessionMock).toHaveBeenCalledWith({
      where: { id: 'session-1' },
      data: { assignedStaffUserId: 'staff-1' },
    });
    expect(result.assignedStaffUserId).toBe('staff-1');
  });

  it('rejects a waiter trying to assign the table to someone else', async () => {
    ensureAccessMock.mockResolvedValue({
      staffUserId: 'staff-1',
      restaurantId: 'restaurant-1',
      branchId: 'branch-1',
      roles: [Role.WAITER],
    });

    await expect(
      service.execute(authUser, 'session-1', { staffUserId: 'staff-2' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(updateSessionMock).not.toHaveBeenCalled();
  });

  it('lets a supervisor reassign the table to another staff member with branch access', async () => {
    ensureAccessMock.mockResolvedValue({
      staffUserId: 'staff-supervisor',
      restaurantId: 'restaurant-1',
      branchId: 'branch-1',
      roles: [Role.SUPERVISOR],
    });
    staffUserBranchRoleFindFirstMock.mockResolvedValue({
      staffUserId: 'staff-2',
    });
    updateSessionMock.mockResolvedValue({
      ...existingSession,
      assignedStaffUserId: 'staff-2',
    });

    const result = await service.execute(authUser, 'session-1', {
      staffUserId: 'staff-2',
    });

    expect(staffUserBranchRoleFindFirstMock).toHaveBeenCalledWith({
      where: {
        staffUserId: 'staff-2',
        branchId: 'branch-1',
        status: BranchRoleStatus.ACTIVE,
        role: { in: [Role.ADMIN, Role.SUPERVISOR, Role.WAITER, Role.CASHIER] },
        staffUser: { status: StaffUserStatus.ACTIVE },
      },
      select: { staffUserId: true },
    });
    expect(result.assignedStaffUserId).toBe('staff-2');
  });

  it('rejects reassigning to a staff member without an active role in the branch', async () => {
    ensureAccessMock.mockResolvedValue({
      staffUserId: 'staff-supervisor',
      restaurantId: 'restaurant-1',
      branchId: 'branch-1',
      roles: [Role.SUPERVISOR],
    });
    staffUserBranchRoleFindFirstMock.mockResolvedValue(null);

    await expect(
      service.execute(authUser, 'session-1', { staffUserId: 'staff-2' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(updateSessionMock).not.toHaveBeenCalled();
  });

  it('rejects reassigning to a staff member whose account is disabled, even if their branch role row is still active', async () => {
    ensureAccessMock.mockResolvedValue({
      staffUserId: 'staff-supervisor',
      restaurantId: 'restaurant-1',
      branchId: 'branch-1',
      roles: [Role.SUPERVISOR],
    });
    staffUserBranchRoleFindFirstMock.mockResolvedValue(null);

    await expect(
      service.execute(authUser, 'session-1', { staffUserId: 'staff-disabled' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(staffUserBranchRoleFindFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          staffUser: { status: StaffUserStatus.ACTIVE },
        }),
      }),
    );
    expect(updateSessionMock).not.toHaveBeenCalled();
  });

  it('rejects assignment when the branch has table assignment disabled', async () => {
    ensureAccessMock.mockResolvedValue({
      staffUserId: 'staff-1',
      restaurantId: 'restaurant-1',
      branchId: 'branch-1',
      roles: [Role.WAITER],
    });
    branchSettingsFindUniqueMock.mockResolvedValue({
      tableAssignmentEnabled: false,
    });

    await expect(
      service.execute(authUser, 'session-1', {}),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(updateSessionMock).not.toHaveBeenCalled();
  });

  it('rejects assignment when the session no longer exists', async () => {
    findUniqueSessionMock.mockResolvedValue(null);

    await expect(
      service.execute(authUser, 'session-1', {}),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects assignment on a session that is no longer active', async () => {
    findUniqueSessionMock.mockResolvedValue({
      ...existingSession,
      status: TableSessionStatus.CLOSED,
    });

    await expect(
      service.execute(authUser, 'session-1', {}),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

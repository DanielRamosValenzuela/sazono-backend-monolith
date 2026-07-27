import { BadRequestException } from '@nestjs/common';
import { Role } from '@prisma/client';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import { SetZoneStaffService } from './set-zone-staff.service';
import type { BranchAccessService } from '../../../common/branch-access/branch-access.service';
import { LoginProfileType } from '../../auth/dto/login.dto';

describe('SetZoneStaffService', () => {
  const findUniqueZoneMock = jest.fn();
  const findManyRolesMock = jest.fn();
  const transactionMock = jest.fn();
  const deleteManyMock = jest.fn();
  const createManyMock = jest.fn();
  const prisma = {
    tableZone: {
      findUnique: findUniqueZoneMock,
    },
    staffUserBranchRole: {
      findMany: findManyRolesMock,
    },
    staffUserZone: {
      deleteMany: deleteManyMock,
      createMany: createManyMock,
    },
    $transaction: transactionMock,
  } as unknown as PrismaService;

  const ensureAccessMock = jest.fn();
  const branchAccessService = {
    ensureAccess: ensureAccessMock,
  } as unknown as BranchAccessService;

  let service: SetZoneStaffService;

  const authUser = {
    sub: 'auth-1',
    profileType: LoginProfileType.STAFF,
    profileId: 'staff-1',
    restaurantId: 'restaurant-1',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    findUniqueZoneMock.mockResolvedValue({
      id: 'zone-1',
      branchId: 'branch-1',
      name: 'Terraza',
      tables: [],
      staffMembers: [{ staffUserId: 'staff-2' }],
    });
    ensureAccessMock.mockResolvedValue({
      staffUserId: 'staff-supervisor',
      restaurantId: 'restaurant-1',
      branchId: 'branch-1',
      roles: [Role.SUPERVISOR],
    });
    transactionMock.mockResolvedValue([{}, {}]);
    service = new SetZoneStaffService(prisma, branchAccessService);
  });

  it('replaces the staff membership of a zone', async () => {
    findManyRolesMock.mockResolvedValue([{ staffUserId: 'staff-2' }]);

    const result = await service.execute(authUser, 'zone-1', {
      staffUserIds: ['staff-2'],
    });

    expect(deleteManyMock).toHaveBeenCalledWith({
      where: { zoneId: 'zone-1' },
    });
    expect(transactionMock).toHaveBeenCalled();
    expect(result.staffUserIds).toEqual(['staff-2']);
  });

  it('rejects assigning a staff member without an active operative role in the branch', async () => {
    findManyRolesMock.mockResolvedValue([]);

    await expect(
      service.execute(authUser, 'zone-1', {
        staffUserIds: ['staff-inactive'],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(transactionMock).not.toHaveBeenCalled();
  });
});

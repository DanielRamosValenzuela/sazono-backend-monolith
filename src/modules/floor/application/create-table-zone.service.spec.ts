import { ConflictException } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import { CreateTableZoneService } from './create-table-zone.service';
import type { BranchAccessService } from '../../../common/branch-access/branch-access.service';
import { LoginProfileType } from '../../auth/dto/login.dto';

describe('CreateTableZoneService', () => {
  const createMock = jest.fn();
  const prisma = {
    tableZone: {
      create: createMock,
    },
  } as unknown as PrismaService;

  const ensureAccessMock = jest.fn();
  const branchAccessService = {
    ensureAccess: ensureAccessMock,
  } as unknown as BranchAccessService;

  let service: CreateTableZoneService;

  const authUser = {
    sub: 'auth-1',
    profileType: LoginProfileType.STAFF,
    profileId: 'staff-1',
    restaurantId: 'restaurant-1',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    ensureAccessMock.mockResolvedValue({
      staffUserId: 'staff-1',
      restaurantId: 'restaurant-1',
      branchId: 'branch-1',
      roles: [Role.ADMIN],
    });
    service = new CreateTableZoneService(prisma, branchAccessService);
  });

  it('creates a zone for the branch', async () => {
    createMock.mockResolvedValue({
      id: 'zone-1',
      branchId: 'branch-1',
      name: 'Terraza',
    });

    const result = await service.execute(authUser, {
      branchId: 'branch-1',
      name: 'Terraza',
    });

    expect(result).toEqual({
      zoneId: 'zone-1',
      branchId: 'branch-1',
      name: 'Terraza',
      tableIds: [],
      staffUserIds: [],
    });
  });

  it('rejects a duplicated zone name inside the same branch', async () => {
    createMock.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );

    await expect(
      service.execute(authUser, {
        branchId: 'branch-1',
        name: 'Terraza',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

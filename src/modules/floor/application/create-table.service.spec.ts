import { ConflictException } from '@nestjs/common';
import { Role, TableStatus } from '@prisma/client';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import { CreateTableService } from './create-table.service';
import type { BranchAccessService } from '../../../common/branch-access/branch-access.service';
import { LoginProfileType } from '../../auth/dto/login.dto';

describe('CreateTableService', () => {
  const findFirstMock = jest.fn();
  const createMock = jest.fn();
  const prisma = {
    table: {
      findFirst: findFirstMock,
      create: createMock,
    },
  } as unknown as PrismaService;

  const ensureAccessMock = jest.fn();
  const BranchAccessService = {
    ensureAccess: ensureAccessMock,
  } as unknown as BranchAccessService;

  let service: CreateTableService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new CreateTableService(prisma, BranchAccessService);
  });

  it('creates a table for the branch', async () => {
    ensureAccessMock.mockResolvedValue({
      staffUserId: 'staff-1',
      restaurantId: 'restaurant-1',
      branchId: 'branch-1',
      roles: [Role.ADMIN],
    });
    findFirstMock.mockResolvedValue(null);
    createMock.mockResolvedValue({
      id: 'table-1',
      branchId: 'branch-1',
      code: 'M01',
      name: 'Mesa 1',
      capacity: 4,
      status: TableStatus.AVAILABLE,
      qrToken: 'qr-token-1',
    });

    const result = await service.execute(
      {
        sub: 'auth-1',
        profileType: LoginProfileType.STAFF,
        profileId: 'staff-1',
        restaurantId: 'restaurant-1',
      },
      {
        branchId: 'branch-1',
        code: 'M01',
        name: 'Mesa 1',
        capacity: 4,
      },
    );

    expect(result.code).toBe('M01');
    expect(result.currentSession).toBeNull();
  });

  it('rejects duplicated table codes inside the same branch', async () => {
    ensureAccessMock.mockResolvedValue({
      staffUserId: 'staff-1',
      restaurantId: 'restaurant-1',
      branchId: 'branch-1',
      roles: [Role.ADMIN],
    });
    findFirstMock.mockResolvedValue({
      id: 'table-existing',
    });

    await expect(
      service.execute(
        {
          sub: 'auth-1',
          profileType: LoginProfileType.STAFF,
          profileId: 'staff-1',
          restaurantId: 'restaurant-1',
        },
        {
          branchId: 'branch-1',
          code: 'M01',
          name: 'Mesa 1',
        },
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

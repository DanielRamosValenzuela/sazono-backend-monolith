import { BadRequestException } from '@nestjs/common';
import { Role, TableStatus } from '@prisma/client';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import { SetTableZoneService } from './set-table-zone.service';
import type { BranchAccessService } from '../../../common/branch-access/branch-access.service';
import { LoginProfileType } from '../../auth/dto/login.dto';

describe('SetTableZoneService', () => {
  const findUniqueTableMock = jest.fn();
  const findFirstZoneMock = jest.fn();
  const branchSettingsFindUniqueMock = jest.fn();
  const updateTableMock = jest.fn();
  const prisma = {
    table: {
      findUnique: findUniqueTableMock,
      update: updateTableMock,
    },
    tableZone: {
      findFirst: findFirstZoneMock,
    },
    branchSettings: {
      findUnique: branchSettingsFindUniqueMock,
    },
  } as unknown as PrismaService;

  const ensureAccessMock = jest.fn();
  const branchAccessService = {
    ensureAccess: ensureAccessMock,
  } as unknown as BranchAccessService;

  let service: SetTableZoneService;

  const authUser = {
    sub: 'auth-1',
    profileType: LoginProfileType.STAFF,
    profileId: 'staff-1',
    restaurantId: 'restaurant-1',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    findUniqueTableMock.mockResolvedValue({
      id: 'table-1',
      branchId: 'branch-1',
      code: 'M01',
      name: 'Mesa 1',
      capacity: 4,
      status: TableStatus.AVAILABLE,
      qrToken: 'qr-token-1',
      zoneId: null,
    });
    ensureAccessMock.mockResolvedValue({
      staffUserId: 'staff-1',
      restaurantId: 'restaurant-1',
      branchId: 'branch-1',
      roles: [Role.ADMIN],
    });
    branchSettingsFindUniqueMock.mockResolvedValue({
      tableAssignmentEnabled: false,
    });
    service = new SetTableZoneService(prisma, branchAccessService);
  });

  it('assigns an existing zone from the same branch to the table', async () => {
    findFirstZoneMock.mockResolvedValue({
      id: 'zone-1',
      branchId: 'branch-1',
      name: 'Terraza',
    });
    updateTableMock.mockResolvedValue({
      id: 'table-1',
      branchId: 'branch-1',
      code: 'M01',
      name: 'Mesa 1',
      capacity: 4,
      status: TableStatus.AVAILABLE,
      qrToken: 'qr-token-1',
      zoneId: 'zone-1',
      tableSessions: [],
    });

    const result = await service.execute(authUser, 'table-1', {
      zoneId: 'zone-1',
    });

    expect(updateTableMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'table-1' },
        data: { zoneId: 'zone-1' },
      }),
    );
    expect(result.zoneId).toBe('zone-1');
  });

  it('rejects a zone that belongs to a different branch', async () => {
    findFirstZoneMock.mockResolvedValue(null);

    await expect(
      service.execute(authUser, 'table-1', { zoneId: 'zone-other-branch' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(updateTableMock).not.toHaveBeenCalled();
  });

  it('unassigns the zone when zoneId is omitted from the body', async () => {
    updateTableMock.mockResolvedValue({
      id: 'table-1',
      branchId: 'branch-1',
      code: 'M01',
      name: 'Mesa 1',
      capacity: 4,
      status: TableStatus.AVAILABLE,
      qrToken: 'qr-token-1',
      zoneId: null,
      tableSessions: [],
    });

    const result = await service.execute(authUser, 'table-1', {});

    expect(findFirstZoneMock).not.toHaveBeenCalled();
    expect(updateTableMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'table-1' },
        data: { zoneId: null },
      }),
    );
    expect(result.zoneId).toBeNull();
  });
});

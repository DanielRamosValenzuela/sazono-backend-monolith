import { BadRequestException, ConflictException } from '@nestjs/common';
import { PreparationStationStatus, PreparationStationType } from '@prisma/client';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import { UpdatePreparationStationService } from './update-preparation-station.service';
import type { BranchAccessService } from '../../../common/branch-access/branch-access.service';
import { LoginProfileType } from '../../auth/dto/login.dto';

describe('UpdatePreparationStationService', () => {
  const stationFindUniqueMock = jest.fn();
  const stationFindFirstMock = jest.fn();
  const stationUpdateMock = jest.fn();
  const prisma = {
    preparationStation: {
      findUnique: stationFindUniqueMock,
      findFirst: stationFindFirstMock,
      update: stationUpdateMock,
    },
  } as unknown as PrismaService;

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

  let service: UpdatePreparationStationService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new UpdatePreparationStationService(prisma, branchAccessService);
  });

  it('renames and deactivates a station', async () => {
    stationFindUniqueMock.mockResolvedValue({
      id: 'station-1',
      branchId: 'branch-1',
      name: 'Cocina',
      stationType: PreparationStationType.KITCHEN,
      status: PreparationStationStatus.ACTIVE,
    });
    ensureAccessMock.mockResolvedValue({ roles: ['ADMIN'] });
    stationFindFirstMock.mockResolvedValue(null);
    stationUpdateMock.mockResolvedValue({
      id: 'station-1',
      branchId: 'branch-1',
      name: 'Cocina Fria',
      stationType: PreparationStationType.KITCHEN,
      status: PreparationStationStatus.INACTIVE,
    });

    const result = await service.execute(authUser, 'station-1', {
      name: 'Cocina Fria',
      status: PreparationStationStatus.INACTIVE,
    });

    expect(result.name).toBe('Cocina Fria');
    expect(result.status).toBe(PreparationStationStatus.INACTIVE);
    expect(ensureAccessMock).toHaveBeenCalledWith(authUser, 'branch-1', [
      'ADMIN',
    ]);
  });

  it('throws when the station does not exist', async () => {
    stationFindUniqueMock.mockResolvedValue(null);

    await expect(
      service.execute(authUser, 'missing-station', { name: 'X' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(ensureAccessMock).not.toHaveBeenCalled();
  });

  it('rejects renaming to a name already used by another station in the branch', async () => {
    stationFindUniqueMock.mockResolvedValue({
      id: 'station-1',
      branchId: 'branch-1',
      name: 'Cocina',
      stationType: PreparationStationType.KITCHEN,
      status: PreparationStationStatus.ACTIVE,
    });
    ensureAccessMock.mockResolvedValue({ roles: ['ADMIN'] });
    stationFindFirstMock.mockResolvedValue({ id: 'station-2' });

    await expect(
      service.execute(authUser, 'station-1', { name: 'Bar' }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(stationUpdateMock).not.toHaveBeenCalled();
  });
});

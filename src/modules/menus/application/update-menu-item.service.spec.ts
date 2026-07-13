import { BadRequestException, ConflictException } from '@nestjs/common';
import {
  MenuStatus,
  PreparationStationStatus,
  PreparationStationType,
} from '@prisma/client';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import { LoginProfileType } from '../../auth/dto/login.dto';
import type { BranchAccessService } from '../../../common/branch-access/branch-access.service';
import { UpdateMenuItemService } from './update-menu-item.service';

describe('UpdateMenuItemService', () => {
  const itemFindUniqueMock = jest.fn();
  const stationFindUniqueMock = jest.fn();
  const itemUpdateMock = jest.fn();
  const prisma = {
    menuItem: {
      findUnique: itemFindUniqueMock,
      update: itemUpdateMock,
    },
    preparationStation: {
      findUnique: stationFindUniqueMock,
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

  let service: UpdateMenuItemService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new UpdateMenuItemService(prisma, branchAccessService);
  });

  it('updates price and availability without touching the station', async () => {
    itemFindUniqueMock.mockResolvedValue({
      id: 'item-1',
      menuCategory: {
        id: 'category-1',
        menu: { id: 'menu-1', branchId: 'branch-1', status: MenuStatus.DRAFT },
      },
    });
    ensureAccessMock.mockResolvedValue({
      staffUserId: 'staff-1',
      branchId: 'branch-1',
      restaurantId: 'restaurant-1',
    });
    itemUpdateMock.mockResolvedValue({
      id: 'item-1',
      menuCategoryId: 'category-1',
      name: 'Pisco Sour',
      description: null,
      price: { toString: () => '6900' },
      sku: null,
      itemType: 'DRINK',
      isAvailable: false,
      sortOrder: 0,
      media: [],
      preparationStation: {
        id: 'station-1',
        name: 'Barra',
        stationType: PreparationStationType.BAR,
        status: PreparationStationStatus.ACTIVE,
      },
    });

    const result = await service.execute(authUser, 'item-1', {
      price: '6900',
      isAvailable: false,
    });

    expect(result.price).toBe('6900');
    expect(result.isAvailable).toBe(false);
    expect(stationFindUniqueMock).not.toHaveBeenCalled();
    const updateArgs = itemUpdateMock.mock.calls[0][0] as {
      data: Record<string, unknown>;
    };
    expect(updateArgs.data).toEqual({ price: '6900', isAvailable: false });
  });

  it('validates a new preparation station belongs to the same branch and is active', async () => {
    itemFindUniqueMock.mockResolvedValue({
      id: 'item-1',
      menuCategory: {
        id: 'category-1',
        menu: { id: 'menu-1', branchId: 'branch-1', status: MenuStatus.DRAFT },
      },
    });
    ensureAccessMock.mockResolvedValue({
      staffUserId: 'staff-1',
      branchId: 'branch-1',
      restaurantId: 'restaurant-1',
    });
    stationFindUniqueMock.mockResolvedValue({
      id: 'station-2',
      branchId: 'branch-2',
      status: PreparationStationStatus.ACTIVE,
    });

    await expect(
      service.execute(authUser, 'item-1', {
        preparationStationId: 'station-2',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(itemUpdateMock).not.toHaveBeenCalled();
  });

  it('rejects edits on a published menu', async () => {
    itemFindUniqueMock.mockResolvedValue({
      id: 'item-1',
      menuCategory: {
        id: 'category-1',
        menu: {
          id: 'menu-1',
          branchId: 'branch-1',
          status: MenuStatus.PUBLISHED,
        },
      },
    });
    ensureAccessMock.mockResolvedValue({
      staffUserId: 'staff-1',
      branchId: 'branch-1',
      restaurantId: 'restaurant-1',
    });

    await expect(
      service.execute(authUser, 'item-1', { name: 'Nuevo nombre' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

import { BadRequestException, ConflictException } from '@nestjs/common';
import {
  MenuStatus,
  PreparationStationStatus,
  PreparationStationType,
} from '@prisma/client';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import { CreateMenuItemService } from './create-menu-item.service';
import type { BranchAccessService } from '../../../common/branch-access/branch-access.service';
import { LoginProfileType } from '../../auth/dto/login.dto';

describe('CreateMenuItemService', () => {
  const categoryFindUniqueMock = jest.fn();
  const stationFindUniqueMock = jest.fn();
  const itemCreateMock = jest.fn();
  const itemAggregateMock = jest.fn();
  const prisma = {
    menuCategory: {
      findUnique: categoryFindUniqueMock,
    },
    preparationStation: {
      findUnique: stationFindUniqueMock,
    },
    menuItem: {
      create: itemCreateMock,
      aggregate: itemAggregateMock,
    },
  } as unknown as PrismaService;

  const ensureAccessMock = jest.fn();
  const branchAccessService = {
    ensureAccess: ensureAccessMock,
  } as unknown as BranchAccessService;

  let service: CreateMenuItemService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new CreateMenuItemService(prisma, branchAccessService);
  });

  it('creates an item when category and station belong to the same branch', async () => {
    categoryFindUniqueMock.mockResolvedValue({
      id: 'category-1',
      menu: {
        id: 'menu-1',
        branchId: 'branch-1',
        status: MenuStatus.DRAFT,
      },
    });
    ensureAccessMock.mockResolvedValue({
      staffUserId: 'staff-1',
      branchId: 'branch-1',
      restaurantId: 'restaurant-1',
    });
    stationFindUniqueMock.mockResolvedValue({
      id: 'station-1',
      branchId: 'branch-1',
      status: PreparationStationStatus.ACTIVE,
    });
    itemAggregateMock.mockResolvedValue({ _max: { sortOrder: null } });
    itemCreateMock.mockResolvedValue({
      id: 'item-1',
      menuCategoryId: 'category-1',
      name: 'Pisco Sour',
      description: 'Clasico',
      price: {
        toString: () => '5900',
      },
      sku: null,
      itemType: 'DRINK',
      isAvailable: true,
      sortOrder: 0,
      preparationStation: {
        id: 'station-1',
        name: 'Barra',
        stationType: PreparationStationType.BAR,
        status: PreparationStationStatus.ACTIVE,
      },
    });

    const result = await service.execute(
      {
        sub: 'auth-1',
        profileType: LoginProfileType.STAFF,
        profileId: 'staff-1',
        restaurantId: 'restaurant-1',
      },
      'category-1',
      {
        name: 'Pisco Sour',
        description: 'Clasico',
        price: '5900',
        itemType: 'DRINK',
        preparationStationId: 'station-1',
      },
    );

    expect(result.menuItemId).toBe('item-1');
    expect(result.preparationStation.stationType).toBe(
      PreparationStationType.BAR,
    );
    const createArgs = itemCreateMock.mock.calls[0][0] as {
      data: { sortOrder: number };
    };
    expect(createArgs.data.sortOrder).toBe(0);
  });

  it('appends new items after the highest existing sortOrder in the category', async () => {
    categoryFindUniqueMock.mockResolvedValue({
      id: 'category-1',
      menu: {
        id: 'menu-1',
        branchId: 'branch-1',
        status: MenuStatus.DRAFT,
      },
    });
    ensureAccessMock.mockResolvedValue({
      staffUserId: 'staff-1',
      branchId: 'branch-1',
      restaurantId: 'restaurant-1',
    });
    stationFindUniqueMock.mockResolvedValue({
      id: 'station-1',
      branchId: 'branch-1',
      status: PreparationStationStatus.ACTIVE,
    });
    itemAggregateMock.mockResolvedValue({ _max: { sortOrder: 2 } });
    itemCreateMock.mockResolvedValue({
      id: 'item-2',
      menuCategoryId: 'category-1',
      name: 'Segundo item',
      description: null,
      price: { toString: () => '4500' },
      sku: null,
      itemType: 'FOOD',
      isAvailable: true,
      sortOrder: 3,
      preparationStation: {
        id: 'station-1',
        name: 'Cocina',
        stationType: PreparationStationType.KITCHEN,
        status: PreparationStationStatus.ACTIVE,
      },
    });

    await service.execute(
      {
        sub: 'auth-1',
        profileType: LoginProfileType.STAFF,
        profileId: 'staff-1',
        restaurantId: 'restaurant-1',
      },
      'category-1',
      {
        name: 'Segundo item',
        price: '4500',
        itemType: 'FOOD',
        preparationStationId: 'station-1',
      },
    );

    const createArgs = itemCreateMock.mock.calls[0][0] as {
      data: { sortOrder: number };
    };
    expect(createArgs.data.sortOrder).toBe(3);
  });

  it('rejects items on published menus', async () => {
    categoryFindUniqueMock.mockResolvedValue({
      id: 'category-1',
      menu: {
        id: 'menu-1',
        branchId: 'branch-1',
        status: MenuStatus.PUBLISHED,
      },
    });
    ensureAccessMock.mockResolvedValue({
      staffUserId: 'staff-1',
      branchId: 'branch-1',
      restaurantId: 'restaurant-1',
    });

    await expect(
      service.execute(
        {
          sub: 'auth-1',
          profileType: LoginProfileType.STAFF,
          profileId: 'staff-1',
          restaurantId: 'restaurant-1',
        },
        'category-1',
        {
          name: 'Pisco Sour',
          price: '5900',
          itemType: 'DRINK',
          preparationStationId: 'station-1',
        },
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects stations from another branch', async () => {
    categoryFindUniqueMock.mockResolvedValue({
      id: 'category-1',
      menu: {
        id: 'menu-1',
        branchId: 'branch-1',
        status: MenuStatus.DRAFT,
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
      service.execute(
        {
          sub: 'auth-1',
          profileType: LoginProfileType.STAFF,
          profileId: 'staff-1',
          restaurantId: 'restaurant-1',
        },
        'category-1',
        {
          name: 'Pisco Sour',
          price: '5900',
          itemType: 'DRINK',
          preparationStationId: 'station-2',
        },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

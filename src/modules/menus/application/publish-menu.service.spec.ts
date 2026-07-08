import { BadRequestException } from '@nestjs/common';
import {
  MenuCategoryStatus,
  MenuStatus,
  PreparationStationStatus,
  PreparationStationType,
} from '@prisma/client';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { MenusBranchAdminAccessService } from './menus-branch-admin-access.service';
import { PublishMenuService } from './publish-menu.service';
import { LoginProfileType } from '../../auth/dto/login.dto';

type TransactionClient = {
  menu: {
    updateMany: jest.Mock<Promise<unknown>, [unknown]>;
    update: jest.Mock<Promise<unknown>, [unknown]>;
    findUniqueOrThrow: jest.Mock<Promise<unknown>, [unknown]>;
  };
  branchSettings: {
    update: jest.Mock<Promise<unknown>, [unknown]>;
  };
};

describe('PublishMenuService', () => {
  const findUniqueMock = jest.fn();
  const transactionMock = jest.fn();
  const prisma = {
    menu: {
      findUnique: findUniqueMock,
    },
    $transaction: transactionMock,
  } as unknown as PrismaService;

  const ensureAdminAccessMock = jest.fn();
  const menusBranchAdminAccessService = {
    ensureAdminAccess: ensureAdminAccessMock,
  } as unknown as MenusBranchAdminAccessService;

  let service: PublishMenuService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new PublishMenuService(prisma, menusBranchAdminAccessService);
  });

  it('publishes a draft menu and marks it as default for the branch', async () => {
    findUniqueMock.mockResolvedValue({
      id: 'menu-1',
      branchId: 'branch-1',
      name: 'Carta principal',
      status: MenuStatus.DRAFT,
      version: 1,
      defaultLanguage: 'es',
      publishedAt: null,
      categories: [
        {
          id: 'category-1',
          name: 'Fondos',
          sortOrder: 0,
          status: MenuCategoryStatus.ACTIVE,
          items: [
            {
              id: 'item-1',
              name: 'Lomo saltado',
              description: null,
              price: {
                toString: () => '11900',
              },
              sku: null,
              itemType: 'FOOD',
              isAvailable: true,
              preparationStation: {
                id: 'station-1',
                name: 'Cocina',
                stationType: PreparationStationType.KITCHEN,
                status: PreparationStationStatus.ACTIVE,
              },
            },
          ],
        },
      ],
    });
    ensureAdminAccessMock.mockResolvedValue({
      staffUserId: 'staff-1',
      branchId: 'branch-1',
      restaurantId: 'restaurant-1',
    });

    const updateManyMock = jest
      .fn<Promise<unknown>, [unknown]>()
      .mockResolvedValue({});
    const updateMock = jest
      .fn<Promise<unknown>, [unknown]>()
      .mockResolvedValue({});
    const updateBranchSettingsMock = jest
      .fn<Promise<unknown>, [unknown]>()
      .mockResolvedValue({});
    const findUniqueOrThrowMock = jest
      .fn<Promise<unknown>, [unknown]>()
      .mockResolvedValue({
        id: 'menu-1',
        branchId: 'branch-1',
        name: 'Carta principal',
        status: MenuStatus.PUBLISHED,
        version: 1,
        defaultLanguage: 'es',
        publishedAt: new Date('2026-07-07T12:00:00.000Z'),
        categories: [
          {
            id: 'category-1',
            name: 'Fondos',
            sortOrder: 0,
            status: MenuCategoryStatus.ACTIVE,
            items: [
              {
                id: 'item-1',
                name: 'Lomo saltado',
                description: null,
                price: {
                  toString: () => '11900',
                },
                sku: null,
                itemType: 'FOOD',
                isAvailable: true,
                preparationStation: {
                  id: 'station-1',
                  name: 'Cocina',
                  stationType: PreparationStationType.KITCHEN,
                  status: PreparationStationStatus.ACTIVE,
                },
              },
            ],
          },
        ],
      });

    transactionMock.mockImplementation(
      (callback: (transactionClient: TransactionClient) => Promise<unknown>) =>
        callback({
          menu: {
            updateMany: updateManyMock,
            update: updateMock,
            findUniqueOrThrow: findUniqueOrThrowMock,
          },
          branchSettings: {
            update: updateBranchSettingsMock,
          },
        }),
    );

    const result = await service.execute(
      {
        sub: 'auth-1',
        profileType: LoginProfileType.STAFF,
        profileId: 'staff-1',
        restaurantId: 'restaurant-1',
      },
      'menu-1',
    );

    expect(result.status).toBe(MenuStatus.PUBLISHED);
    expect(result.isDefaultMenu).toBe(true);
    expect(updateBranchSettingsMock).toHaveBeenCalled();
  });

  it('rejects publishing a menu without active categories with items', async () => {
    findUniqueMock.mockResolvedValue({
      id: 'menu-1',
      branchId: 'branch-1',
      status: MenuStatus.DRAFT,
      categories: [
        {
          id: 'category-1',
          status: MenuCategoryStatus.HIDDEN,
          items: [],
        },
      ],
    });
    ensureAdminAccessMock.mockResolvedValue({
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
        'menu-1',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

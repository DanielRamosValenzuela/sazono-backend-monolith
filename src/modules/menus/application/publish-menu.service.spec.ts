import { BadRequestException } from '@nestjs/common';
import {
  MenuCategoryStatus,
  MenuStatus,
  PreparationStationStatus,
  PreparationStationType,
} from '@prisma/client';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { BranchAccessService } from '../../../common/branch-access/branch-access.service';
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

  const ensureAccessMock = jest.fn();
  const branchAccessService = {
    ensureAccess: ensureAccessMock,
  } as unknown as BranchAccessService;

  let service: PublishMenuService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new PublishMenuService(prisma, branchAccessService);
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
              sortOrder: 0,
              media: [],
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
    ensureAccessMock.mockResolvedValue({
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
                sortOrder: 0,
                media: [],
                preparationStation: {
                  id: 'station-1',
                  name: 'Cocina',
                  stationType: PreparationStationType.KITCHEN,
                  status: PreparationStationStatus.ACTIVE,
                },
                modifierGroups: [],
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
    expect(result.warnings).toEqual([]);
    expect(updateBranchSettingsMock).toHaveBeenCalled();
  });

  it('publishes a menu whose parent category only has subcategories with items', async () => {
    const station = {
      id: 'station-1',
      name: 'Cocina',
      stationType: PreparationStationType.KITCHEN,
      status: PreparationStationStatus.ACTIVE,
    };
    const item = {
      id: 'item-1',
      name: 'Latte',
      description: null,
      price: { toString: () => '3500' },
      sku: null,
      itemType: 'DRINK',
      isAvailable: true,
      sortOrder: 0,
      media: [],
      preparationStation: station,
      modifierGroups: [],
    };
    const categories = [
      {
        id: 'cafe',
        name: 'Cafe',
        sortOrder: 0,
        status: MenuCategoryStatus.ACTIVE,
        parentId: null,
        items: [],
      },
      {
        id: 'calientes',
        name: 'Bebidas Calientes',
        sortOrder: 1,
        status: MenuCategoryStatus.ACTIVE,
        parentId: 'cafe',
        items: [item],
      },
    ];

    findUniqueMock.mockResolvedValue({
      id: 'menu-1',
      branchId: 'branch-1',
      status: MenuStatus.DRAFT,
      categories,
    });
    ensureAccessMock.mockResolvedValue({
      staffUserId: 'staff-1',
      branchId: 'branch-1',
      restaurantId: 'restaurant-1',
    });
    transactionMock.mockImplementation(
      (callback: (transactionClient: TransactionClient) => Promise<unknown>) =>
        callback({
          menu: {
            updateMany: jest.fn().mockResolvedValue({}),
            update: jest.fn().mockResolvedValue({}),
            findUniqueOrThrow: jest.fn().mockResolvedValue({
              id: 'menu-1',
              branchId: 'branch-1',
              name: 'Carta',
              status: MenuStatus.PUBLISHED,
              version: 1,
              defaultLanguage: 'es',
              publishedAt: new Date('2026-07-07T12:00:00.000Z'),
              categories,
            }),
          },
          branchSettings: { update: jest.fn().mockResolvedValue({}) },
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
    expect(
      result.categories.map((c) => [c.menuCategoryId, c.parentId]),
    ).toEqual([
      ['cafe', null],
      ['calientes', 'cafe'],
    ]);
  });

  it('returns advisory warnings for options whose required sub-group is unavailable', async () => {
    const opt = (id: string, isAvailable: boolean, childGroups: unknown[]) => ({
      id,
      name: id,
      priceDelta: { toString: () => '0' },
      isAvailable,
      sortOrder: 0,
      imageUrl: null,
      childGroups,
    });
    const grp = (id: string, options: unknown[], isRequired: boolean) => ({
      id,
      branchId: 'branch-1',
      name: id,
      selectionType: 'ONE',
      minSelect: 0,
      maxSelect: 1,
      isRequired,
      sortOrder: 0,
      options,
    });
    const categories = [
      {
        id: 'c1',
        name: 'Fondos',
        sortOrder: 0,
        status: MenuCategoryStatus.ACTIVE,
        parentId: null,
        items: [
          {
            id: 'item-1',
            name: 'Hamburguesa',
            description: null,
            price: { toString: () => '8000' },
            sku: null,
            itemType: 'FOOD',
            isAvailable: true,
            sortOrder: 0,
            media: [],
            preparationStation: {
              id: 'station-1',
              name: 'Cocina',
              stationType: PreparationStationType.KITCHEN,
              status: PreparationStationStatus.ACTIVE,
            },
            modifierGroups: [
              {
                sortOrder: 0,
                modifierGroup: grp(
                  'acomp',
                  [
                    opt('Papas', true, [
                      grp('Tipo', [opt('Fritas', false, [])], true),
                    ]),
                  ],
                  false,
                ),
              },
            ],
          },
        ],
      },
    ];

    findUniqueMock.mockResolvedValue({
      id: 'menu-1',
      branchId: 'branch-1',
      status: MenuStatus.DRAFT,
      categories,
    });
    ensureAccessMock.mockResolvedValue({});
    transactionMock.mockImplementation(
      (callback: (transactionClient: TransactionClient) => Promise<unknown>) =>
        callback({
          menu: {
            updateMany: jest.fn().mockResolvedValue({}),
            update: jest.fn().mockResolvedValue({}),
            findUniqueOrThrow: jest.fn().mockResolvedValue({
              id: 'menu-1',
              branchId: 'branch-1',
              name: 'Carta',
              status: MenuStatus.PUBLISHED,
              version: 1,
              defaultLanguage: 'es',
              publishedAt: new Date('2026-07-07T12:00:00.000Z'),
              categories,
            }),
          },
          branchSettings: { update: jest.fn().mockResolvedValue({}) },
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

    expect(result.warnings).toEqual([
      {
        code: 'OPTION_REQUIRED_SUBGROUP_UNAVAILABLE',
        optionName: 'Papas',
        groupName: 'Tipo',
      },
    ]);
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
        'menu-1',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

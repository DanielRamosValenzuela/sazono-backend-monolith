import { Prisma } from '@prisma/client';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import { OrderableMenuItemResolverService } from './orderable-menu-item-resolver.service';

describe('OrderableMenuItemResolverService', () => {
  const branchSettingsFindUniqueMock = jest.fn();
  const menuItemFindManyMock = jest.fn();
  const prisma = {
    branchSettings: { findUnique: branchSettingsFindUniqueMock },
    menuItem: { findMany: menuItemFindManyMock },
  } as unknown as PrismaService;
  const service = new OrderableMenuItemResolverService(prisma);

  beforeEach(() => {
    jest.clearAllMocks();
    branchSettingsFindUniqueMock.mockResolvedValue({
      defaultMenu: { id: 'menu-1', status: 'PUBLISHED' },
    });
  });

  it('resolves the category id and the root-to-category path of a nested category', async () => {
    menuItemFindManyMock.mockResolvedValue([
      {
        id: 'latte',
        name: 'Latte',
        price: new Prisma.Decimal(3500),
        isAvailable: true,
        menuCategoryId: 'calientes',
        preparationStationId: 'station-1',
        menuCategory: {
          id: 'calientes',
          name: 'Bebidas Calientes',
          status: 'ACTIVE',
          parent: { name: 'Cafe', status: 'ACTIVE', parent: null },
        },
        preparationStation: { status: 'ACTIVE' },
        modifierGroups: [],
      },
    ]);

    const [resolved] = await service.resolve('branch-1', [
      { menuItemId: 'latte', quantity: 2 },
    ]);

    expect(resolved).toMatchObject({
      menuItemId: 'latte',
      menuCategoryId: 'calientes',
      categoryPath: ['Cafe', 'Bebidas Calientes'],
    });
  });

  it('rejects an item whose ancestor category is inactive', async () => {
    menuItemFindManyMock.mockResolvedValue([
      {
        id: 'latte',
        name: 'Latte',
        price: new Prisma.Decimal(3500),
        isAvailable: true,
        menuCategoryId: 'calientes',
        preparationStationId: 'station-1',
        menuCategory: {
          id: 'calientes',
          name: 'Bebidas Calientes',
          status: 'ACTIVE',
          parent: { name: 'Cafe', status: 'INACTIVE', parent: null },
        },
        preparationStation: { status: 'ACTIVE' },
        modifierGroups: [],
      },
    ]);

    await expect(
      service.resolve('branch-1', [{ menuItemId: 'latte', quantity: 1 }]),
    ).rejects.toThrow('no esta disponible para ordenar');
  });

  it('resolves a one element path for a root category', async () => {
    menuItemFindManyMock.mockResolvedValue([
      {
        id: 'torta',
        name: 'Torta',
        price: new Prisma.Decimal(2500),
        isAvailable: true,
        menuCategoryId: 'postres',
        preparationStationId: 'station-1',
        menuCategory: {
          id: 'postres',
          name: 'Postres',
          status: 'ACTIVE',
          parent: null,
        },
        preparationStation: { status: 'ACTIVE' },
        modifierGroups: [],
      },
    ]);

    const [resolved] = await service.resolve('branch-1', [
      { menuItemId: 'torta', quantity: 1 },
    ]);

    expect(resolved.categoryPath).toEqual(['Postres']);
  });

  it('adds the modifier deltas to the unit price, so priceSnapshot already includes them', async () => {
    menuItemFindManyMock.mockResolvedValue([
      {
        id: 'lomo',
        name: 'Lomo saltado',
        price: new Prisma.Decimal(11900),
        isAvailable: true,
        menuCategoryId: 'fondos',
        preparationStationId: 'station-1',
        menuCategory: {
          id: 'fondos',
          name: 'Fondos',
          status: 'ACTIVE',
          parent: null,
        },
        preparationStation: { status: 'ACTIVE' },
        modifierGroups: [
          {
            modifierGroup: {
              id: 'group-1',
              name: 'Extras',
              minSelect: 0,
              maxSelect: null,
              isRequired: false,
              options: [
                {
                  id: 'option-1',
                  name: 'Papas',
                  priceDelta: new Prisma.Decimal(1500),
                  isAvailable: true,
                },
              ],
            },
          },
        ],
      },
    ]);

    const [resolved] = await service.resolve('branch-1', [
      { menuItemId: 'lomo', quantity: 1, modifierOptionIds: ['option-1'] },
    ]);

    expect(resolved.price).toEqual(new Prisma.Decimal(13400));
  });
});

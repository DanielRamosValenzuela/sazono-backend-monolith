import { NotFoundException } from '@nestjs/common';
import {
  MenuCategoryStatus,
  MenuStatus,
  PreparationStationStatus,
  PreparationStationType,
  TableStatus,
} from '@prisma/client';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import { GetPublishedMenuByQrService } from './get-published-menu-by-qr.service';

describe('GetPublishedMenuByQrService', () => {
  const tableFindUniqueMock = jest.fn();
  const menuFindUniqueOrThrowMock = jest.fn();
  const translationFindManyMock = jest.fn();

  const prisma = {
    table: {
      findUnique: tableFindUniqueMock,
    },
    menu: {
      findUniqueOrThrow: menuFindUniqueOrThrowMock,
    },
    translation: {
      findMany: translationFindManyMock,
    },
  } as unknown as PrismaService;

  let service: GetPublishedMenuByQrService;

  const table = {
    status: TableStatus.AVAILABLE,
    branch: {
      settings: {
        defaultMenu: { id: 'menu-1', status: MenuStatus.PUBLISHED },
      },
    },
  };

  const menuFixture = {
    id: 'menu-1',
    branchId: 'branch-1',
    name: 'Carta principal',
    status: MenuStatus.PUBLISHED,
    version: 1,
    defaultLanguage: 'es',
    publishedAt: new Date('2026-07-01T00:00:00.000Z'),
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
            description: 'Con papas fritas.',
            price: { toString: () => '11900' },
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
  };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new GetPublishedMenuByQrService(prisma);
    tableFindUniqueMock.mockResolvedValue(table);
    menuFindUniqueOrThrowMock.mockResolvedValue(menuFixture);
  });

  it('returns the original content when no locale is requested', async () => {
    const result = await service.execute('qr-token');

    expect(result.categories[0].name).toBe('Fondos');
    expect(result.categories[0].items[0].name).toBe('Lomo saltado');
    expect(translationFindManyMock).not.toHaveBeenCalled();
  });

  it('skips the translations query when the requested locale matches the default language', async () => {
    const result = await service.execute('qr-token', 'es');

    expect(result.categories[0].name).toBe('Fondos');
    expect(translationFindManyMock).not.toHaveBeenCalled();
  });

  it('substitutes name and description when a translation exists for the requested locale', async () => {
    translationFindManyMock.mockResolvedValue([
      {
        entityId: 'category-1',
        locale: 'en',
        fieldName: 'name',
        translatedValue: 'Mains',
      },
      {
        entityId: 'item-1',
        locale: 'en',
        fieldName: 'name',
        translatedValue: 'Beef stir-fry',
      },
      {
        entityId: 'item-1',
        locale: 'en',
        fieldName: 'description',
        translatedValue: 'With fries.',
      },
    ]);

    const result = await service.execute('qr-token', 'en');

    expect(result.categories[0].name).toBe('Mains');
    expect(result.categories[0].items[0].name).toBe('Beef stir-fry');
    expect(result.categories[0].items[0].description).toBe('With fries.');
    expect(result.categories[0].translations).toEqual([]);
    expect(result.categories[0].items[0].translations).toEqual([]);
  });

  it('falls back to the original content when no translation exists for that locale', async () => {
    translationFindManyMock.mockResolvedValue([]);

    const result = await service.execute('qr-token', 'en');

    expect(result.categories[0].name).toBe('Fondos');
    expect(result.categories[0].items[0].name).toBe('Lomo saltado');
    expect(result.categories[0].items[0].description).toBe('Con papas fritas.');
  });

  it('throws when the qr token does not resolve to an available table', async () => {
    tableFindUniqueMock.mockResolvedValue(null);

    await expect(service.execute('missing-token')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

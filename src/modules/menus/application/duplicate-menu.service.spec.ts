import { BadRequestException, ForbiddenException } from '@nestjs/common';
import {
  MenuCategoryStatus,
  MenuStatus,
  TranslationEntityType,
} from '@prisma/client';
import type { BranchAccessService } from '../../../common/branch-access/branch-access.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import { LoginProfileType } from '../../auth/dto/login.dto';
import { DuplicateMenuService } from './duplicate-menu.service';
import type { GetMenuDetailService } from './get-menu-detail.service';

type CreateManyArgs = { data: Array<Record<string, unknown>> };

describe('DuplicateMenuService', () => {
  const authUser = {
    sub: 'auth-1',
    profileType: LoginProfileType.STAFF,
    profileId: 'staff-1',
    restaurantId: 'restaurant-1',
  };

  const findUniqueMock = jest.fn();
  const translationFindManyMock = jest.fn();
  const transactionMock = jest.fn();
  const prisma = {
    menu: { findUnique: findUniqueMock },
    translation: { findMany: translationFindManyMock },
    $transaction: transactionMock,
  } as unknown as PrismaService;

  const ensureAccessMock = jest.fn();
  const branchAccessService = {
    ensureAccess: ensureAccessMock,
  } as unknown as BranchAccessService;

  const executeDetailMock = jest.fn();
  const getMenuDetailService = {
    execute: executeDetailMock,
  } as unknown as GetMenuDetailService;

  const menuFindFirstMock = jest.fn();
  const menuCreateMock = jest.fn();
  const categoryCreateManyMock = jest.fn();
  const itemCreateManyMock = jest.fn();
  const mediaCreateManyMock = jest.fn();
  const modifierCreateManyMock = jest.fn();
  const translationCreateManyMock = jest.fn();

  const sourceMenu = (status: MenuStatus) => ({
    id: 'menu-1',
    branchId: 'branch-1',
    name: 'Carta verano',
    status,
    version: 4,
    defaultLanguage: 'es',
    publishedAt: null,
    categories: [
      {
        id: 'cat-root',
        menuId: 'menu-1',
        name: 'Bebidas',
        sortOrder: 0,
        status: MenuCategoryStatus.ACTIVE,
        parentId: null,
        items: [],
      },
      {
        id: 'cat-child',
        menuId: 'menu-1',
        name: 'Cocteles',
        sortOrder: 1,
        status: MenuCategoryStatus.HIDDEN,
        parentId: 'cat-root',
        items: [
          {
            id: 'item-1',
            name: 'Pisco Sour',
            description: 'Clasico',
            price: '5900',
            sku: 'PS-1',
            itemType: 'DRINK',
            preparationStationId: 'station-1',
            isAvailable: false,
            sortOrder: 2,
            media: [
              { mediaType: 'image', url: 'https://cdn/x.jpg', sortOrder: 0 },
            ],
            modifierGroups: [{ modifierGroupId: 'group-1', sortOrder: 3 }],
          },
        ],
      },
    ],
  });

  let service: DuplicateMenuService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new DuplicateMenuService(
      prisma,
      branchAccessService,
      getMenuDetailService,
    );
    ensureAccessMock.mockResolvedValue(undefined);
    translationFindManyMock.mockResolvedValue([
      {
        entityType: TranslationEntityType.MENU_CATEGORY,
        entityId: 'cat-child',
        locale: 'en',
        fieldName: 'name',
        translatedValue: 'Cocktails',
      },
      {
        entityType: TranslationEntityType.MENU_ITEM,
        entityId: 'item-1',
        locale: 'en',
        fieldName: 'name',
        translatedValue: 'Pisco Sour EN',
      },
    ]);
    menuFindFirstMock.mockResolvedValue({ version: 7 });
    menuCreateMock.mockResolvedValue({ id: 'menu-new' });
    executeDetailMock.mockResolvedValue({ menuId: 'menu-new' });
    transactionMock.mockImplementation(
      (callback: (tx: unknown) => Promise<unknown>) =>
        callback({
          menu: { findFirst: menuFindFirstMock, create: menuCreateMock },
          menuCategory: { createMany: categoryCreateManyMock },
          menuItem: { createMany: itemCreateManyMock },
          menuItemMedia: { createMany: mediaCreateManyMock },
          menuItemModifierGroup: { createMany: modifierCreateManyMock },
          translation: { createMany: translationCreateManyMock },
        }),
    );
  });

  it('copies the whole tree into a new draft with remapped ids in one transaction', async () => {
    findUniqueMock.mockResolvedValue(sourceMenu(MenuStatus.PUBLISHED));

    const result = await service.execute(authUser, 'menu-1', {});

    expect(result).toEqual({ menuId: 'menu-new' });
    expect(ensureAccessMock).toHaveBeenCalledWith(authUser, 'branch-1', [
      'ADMIN',
    ]);
    expect(transactionMock).toHaveBeenCalledTimes(1);
    expect(menuCreateMock).toHaveBeenCalledWith({
      data: {
        branchId: 'branch-1',
        name: 'Carta verano (copia)',
        defaultLanguage: 'es',
        status: MenuStatus.DRAFT,
        version: 8,
      },
    });

    const categories = (
      categoryCreateManyMock.mock.calls[0] as [CreateManyArgs]
    )[0].data;
    expect(categories).toHaveLength(2);
    const [root, child] = categories;
    expect(root.id).not.toBe('cat-root');
    expect(child.id).not.toBe('cat-child');
    expect(root.parentId).toBeNull();
    expect(child.parentId).toBe(root.id);
    expect(child).toMatchObject({
      menuId: 'menu-new',
      name: 'Cocteles',
      sortOrder: 1,
      status: MenuCategoryStatus.HIDDEN,
    });

    const items = (itemCreateManyMock.mock.calls[0] as [CreateManyArgs])[0]
      .data;
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      menuCategoryId: child.id,
      name: 'Pisco Sour',
      description: 'Clasico',
      price: '5900',
      sku: 'PS-1',
      itemType: 'DRINK',
      preparationStationId: 'station-1',
      isAvailable: false,
      sortOrder: 2,
    });
    expect(items[0].id).not.toBe('item-1');

    expect(mediaCreateManyMock).toHaveBeenCalledWith({
      data: [
        {
          menuItemId: items[0].id,
          mediaType: 'image',
          url: 'https://cdn/x.jpg',
          sortOrder: 0,
        },
      ],
    });
    expect(modifierCreateManyMock).toHaveBeenCalledWith({
      data: [
        { menuItemId: items[0].id, modifierGroupId: 'group-1', sortOrder: 3 },
      ],
    });

    const copiedTranslations = (
      translationCreateManyMock.mock.calls[0] as [CreateManyArgs]
    )[0].data;
    expect(copiedTranslations).toEqual([
      {
        entityType: TranslationEntityType.MENU_CATEGORY,
        entityId: child.id,
        locale: 'en',
        fieldName: 'name',
        translatedValue: 'Cocktails',
      },
      {
        entityType: TranslationEntityType.MENU_ITEM,
        entityId: items[0].id,
        locale: 'en',
        fieldName: 'name',
        translatedValue: 'Pisco Sour EN',
      },
    ]);
    expect(executeDetailMock).toHaveBeenCalledWith(authUser, 'menu-new');
  });

  it('never writes to the source menu and works from DRAFT and ARCHIVED too', async () => {
    for (const status of [MenuStatus.DRAFT, MenuStatus.ARCHIVED]) {
      findUniqueMock.mockResolvedValue(sourceMenu(status));
      await service.execute(authUser, 'menu-1', {});
    }

    expect(menuCreateMock).toHaveBeenCalledTimes(2);
    expect(menuCreateMock.mock.calls[0][0]).toMatchObject({
      data: { status: MenuStatus.DRAFT },
    });
    expect(menuCreateMock.mock.calls[1][0]).toMatchObject({
      data: { status: MenuStatus.DRAFT },
    });
  });

  it('uses the provided name and truncates the default one to 120 characters', async () => {
    findUniqueMock.mockResolvedValue(sourceMenu(MenuStatus.DRAFT));
    await service.execute(authUser, 'menu-1', { name: '  Carta nueva  ' });
    expect(menuCreateMock.mock.calls[0][0]).toMatchObject({
      data: { name: 'Carta nueva' },
    });

    findUniqueMock.mockResolvedValue({
      ...sourceMenu(MenuStatus.DRAFT),
      name: 'x'.repeat(120),
    });
    await service.execute(authUser, 'menu-1', {});
    const longName = (
      menuCreateMock.mock.calls[1][0] as { data: { name: string } }
    ).data.name;
    expect(longName).toHaveLength(120);
    expect(longName.endsWith(' (copia)')).toBe(true);
  });

  it('skips empty createMany calls for a menu without items', async () => {
    findUniqueMock.mockResolvedValue({
      ...sourceMenu(MenuStatus.DRAFT),
      categories: [],
    });
    translationFindManyMock.mockResolvedValue([]);

    await service.execute(authUser, 'menu-1', {});

    expect(categoryCreateManyMock).not.toHaveBeenCalled();
    expect(itemCreateManyMock).not.toHaveBeenCalled();
    expect(mediaCreateManyMock).not.toHaveBeenCalled();
    expect(modifierCreateManyMock).not.toHaveBeenCalled();
    expect(translationCreateManyMock).not.toHaveBeenCalled();
  });

  it('rejects users without access to the branch', async () => {
    findUniqueMock.mockResolvedValue(sourceMenu(MenuStatus.PUBLISHED));
    ensureAccessMock.mockRejectedValue(new ForbiddenException());

    await expect(service.execute(authUser, 'menu-1', {})).rejects.toThrow(
      ForbiddenException,
    );
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it('rejects an unknown menu', async () => {
    findUniqueMock.mockResolvedValue(null);

    await expect(service.execute(authUser, 'nope', {})).rejects.toThrow(
      BadRequestException,
    );
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it('propagates a failure inside the transaction without returning a menu', async () => {
    findUniqueMock.mockResolvedValue(sourceMenu(MenuStatus.DRAFT));
    itemCreateManyMock.mockRejectedValue(new Error('boom'));

    await expect(service.execute(authUser, 'menu-1', {})).rejects.toThrow(
      'boom',
    );
    expect(executeDetailMock).not.toHaveBeenCalled();
  });
});

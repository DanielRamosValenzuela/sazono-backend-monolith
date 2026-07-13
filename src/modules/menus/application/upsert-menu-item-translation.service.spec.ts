import { BadRequestException, ConflictException } from '@nestjs/common';
import { MenuStatus } from '@prisma/client';
import { LoginProfileType } from '../../auth/dto/login.dto';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { BranchAccessService } from '../../../common/branch-access/branch-access.service';
import { UpsertMenuItemTranslationService } from './upsert-menu-item-translation.service';

describe('UpsertMenuItemTranslationService', () => {
  const itemFindUniqueMock = jest.fn();
  const translationDeleteManyMock = jest.fn();
  const translationCreateMock = jest.fn();
  const transactionMock = jest.fn();

  const prisma = {
    menuItem: {
      findUnique: itemFindUniqueMock,
    },
    translation: {
      deleteMany: translationDeleteManyMock,
      create: translationCreateMock,
    },
    $transaction: transactionMock,
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

  let service: UpsertMenuItemTranslationService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new UpsertMenuItemTranslationService(
      prisma,
      branchAccessService,
    );
    ensureAccessMock.mockResolvedValue({
      staffUserId: 'staff-1',
      branchId: 'branch-1',
      restaurantId: 'restaurant-1',
    });
    transactionMock.mockResolvedValue([]);
  });

  it('creates name and description translations together', async () => {
    itemFindUniqueMock.mockResolvedValue({
      id: 'item-1',
      menuCategory: {
        id: 'category-1',
        menu: { id: 'menu-1', branchId: 'branch-1', status: MenuStatus.DRAFT },
      },
    });

    const result = await service.execute(authUser, 'item-1', 'en', {
      name: 'Pisco Sour',
      description: 'Pisco, lime and syrup.',
    });

    expect(result).toEqual({
      locale: 'en',
      name: 'Pisco Sour',
      description: 'Pisco, lime and syrup.',
    });
    expect(translationDeleteManyMock).toHaveBeenCalledWith({
      where: {
        entityType: 'MENU_ITEM',
        entityId: 'item-1',
        locale: 'en',
        fieldName: { in: ['name', 'description'] },
      },
    });
    expect(translationCreateMock).toHaveBeenCalledTimes(2);
  });

  it('only creates a name translation when description is omitted', async () => {
    itemFindUniqueMock.mockResolvedValue({
      id: 'item-1',
      menuCategory: {
        id: 'category-1',
        menu: { id: 'menu-1', branchId: 'branch-1', status: MenuStatus.DRAFT },
      },
    });

    const result = await service.execute(authUser, 'item-1', 'en', {
      name: 'Pisco Sour',
    });

    expect(result.description).toBeNull();
    expect(translationCreateMock).toHaveBeenCalledTimes(1);
    expect(translationCreateMock).toHaveBeenCalledWith({
      data: {
        entityType: 'MENU_ITEM',
        entityId: 'item-1',
        locale: 'en',
        fieldName: 'name',
        translatedValue: 'Pisco Sour',
      },
    });
  });

  it('rejects editing translations on a published menu', async () => {
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

    await expect(
      service.execute(authUser, 'item-1', 'en', { name: 'Pisco Sour' }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it('rejects an item id that does not exist', async () => {
    itemFindUniqueMock.mockResolvedValue(null);

    await expect(
      service.execute(authUser, 'missing-item', 'en', { name: 'X' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

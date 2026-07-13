import { BadRequestException, ConflictException } from '@nestjs/common';
import { MenuStatus } from '@prisma/client';
import { LoginProfileType } from '../../auth/dto/login.dto';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { BranchAccessService } from '../../../common/branch-access/branch-access.service';
import { UpsertMenuCategoryTranslationService } from './upsert-menu-category-translation.service';

describe('UpsertMenuCategoryTranslationService', () => {
  const categoryFindUniqueMock = jest.fn();
  const translationDeleteManyMock = jest.fn();
  const translationCreateMock = jest.fn();
  const transactionMock = jest.fn();

  const prisma = {
    menuCategory: {
      findUnique: categoryFindUniqueMock,
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

  let service: UpsertMenuCategoryTranslationService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new UpsertMenuCategoryTranslationService(
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

  it('replaces any existing translation for that locale in a single transaction', async () => {
    categoryFindUniqueMock.mockResolvedValue({
      id: 'category-1',
      menu: { id: 'menu-1', branchId: 'branch-1', status: MenuStatus.DRAFT },
    });

    const result = await service.execute(authUser, 'category-1', 'en', {
      name: '  Mains  ',
    });

    expect(result).toEqual({ locale: 'en', name: 'Mains', description: null });
    expect(translationDeleteManyMock).toHaveBeenCalledWith({
      where: {
        entityType: 'MENU_CATEGORY',
        entityId: 'category-1',
        locale: 'en',
        fieldName: 'name',
      },
    });
    expect(translationCreateMock).toHaveBeenCalledWith({
      data: {
        entityType: 'MENU_CATEGORY',
        entityId: 'category-1',
        locale: 'en',
        fieldName: 'name',
        translatedValue: 'Mains',
      },
    });
  });

  it('rejects editing translations on a published menu', async () => {
    categoryFindUniqueMock.mockResolvedValue({
      id: 'category-1',
      menu: {
        id: 'menu-1',
        branchId: 'branch-1',
        status: MenuStatus.PUBLISHED,
      },
    });

    await expect(
      service.execute(authUser, 'category-1', 'en', { name: 'Mains' }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it('rejects a category id that does not exist', async () => {
    categoryFindUniqueMock.mockResolvedValue(null);

    await expect(
      service.execute(authUser, 'missing-category', 'en', { name: 'Mains' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

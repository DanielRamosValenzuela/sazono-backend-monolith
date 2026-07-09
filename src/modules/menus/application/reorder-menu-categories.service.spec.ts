import { BadRequestException, ConflictException } from '@nestjs/common';
import { MenuStatus } from '@prisma/client';
import { LoginProfileType } from '../../auth/dto/login.dto';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { MenusBranchAdminAccessService } from './menus-branch-admin-access.service';
import { ReorderMenuCategoriesService } from './reorder-menu-categories.service';

describe('ReorderMenuCategoriesService', () => {
  const menuFindUniqueMock = jest.fn();
  const categoryUpdateMock = jest.fn();
  const transactionMock = jest.fn();
  const prisma = {
    menu: {
      findUnique: menuFindUniqueMock,
    },
    menuCategory: {
      update: categoryUpdateMock,
    },
    $transaction: transactionMock,
  } as unknown as PrismaService;

  const ensureAdminAccessMock = jest.fn();
  const menusBranchAdminAccessService = {
    ensureAdminAccess: ensureAdminAccessMock,
  } as unknown as MenusBranchAdminAccessService;

  const authUser = {
    sub: 'auth-1',
    profileType: LoginProfileType.STAFF,
    profileId: 'staff-1',
    restaurantId: 'restaurant-1',
  };

  let service: ReorderMenuCategoriesService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ReorderMenuCategoriesService(
      prisma,
      menusBranchAdminAccessService,
    );
    ensureAdminAccessMock.mockResolvedValue({
      staffUserId: 'staff-1',
      branchId: 'branch-1',
      restaurantId: 'restaurant-1',
    });
    transactionMock.mockResolvedValue([]);
  });

  it('reorders categories in a single transaction, sortOrder matching array index', async () => {
    menuFindUniqueMock.mockResolvedValue({
      id: 'menu-1',
      branchId: 'branch-1',
      status: MenuStatus.DRAFT,
      categories: [{ id: 'cat-a' }, { id: 'cat-b' }, { id: 'cat-c' }],
    });

    const result = await service.execute(authUser, 'menu-1', {
      orderedCategoryIds: ['cat-c', 'cat-a', 'cat-b'],
    });

    expect(result).toEqual({ reorderedCount: 3 });
    expect(transactionMock).toHaveBeenCalledTimes(1);
    const updateCalls = categoryUpdateMock.mock.calls;
    expect(updateCalls[0][0]).toEqual({
      where: { id: 'cat-c' },
      data: { sortOrder: 0 },
    });
    expect(updateCalls[1][0]).toEqual({
      where: { id: 'cat-a' },
      data: { sortOrder: 1 },
    });
    expect(updateCalls[2][0]).toEqual({
      where: { id: 'cat-b' },
      data: { sortOrder: 2 },
    });
  });

  it('rejects when the id list does not match the menu categories', async () => {
    menuFindUniqueMock.mockResolvedValue({
      id: 'menu-1',
      branchId: 'branch-1',
      status: MenuStatus.DRAFT,
      categories: [{ id: 'cat-a' }, { id: 'cat-b' }],
    });

    await expect(
      service.execute(authUser, 'menu-1', {
        orderedCategoryIds: ['cat-a', 'cat-missing'],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it('rejects reordering on a published menu', async () => {
    menuFindUniqueMock.mockResolvedValue({
      id: 'menu-1',
      branchId: 'branch-1',
      status: MenuStatus.PUBLISHED,
      categories: [{ id: 'cat-a' }],
    });

    await expect(
      service.execute(authUser, 'menu-1', {
        orderedCategoryIds: ['cat-a'],
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects a menu id that does not exist', async () => {
    menuFindUniqueMock.mockResolvedValue(null);

    await expect(
      service.execute(authUser, 'missing-menu', {
        orderedCategoryIds: ['cat-a'],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

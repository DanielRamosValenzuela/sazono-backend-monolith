import { BadRequestException, ConflictException } from '@nestjs/common';
import { MenuStatus } from '@prisma/client';
import { LoginProfileType } from '../../auth/dto/login.dto';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { MenusBranchAdminAccessService } from './menus-branch-admin-access.service';
import { ReorderMenuItemsService } from './reorder-menu-items.service';

describe('ReorderMenuItemsService', () => {
  const categoryFindUniqueMock = jest.fn();
  const itemUpdateMock = jest.fn();
  const transactionMock = jest.fn();
  const prisma = {
    menuCategory: {
      findUnique: categoryFindUniqueMock,
    },
    menuItem: {
      update: itemUpdateMock,
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

  let service: ReorderMenuItemsService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ReorderMenuItemsService(
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

  it('reorders items in a single transaction, sortOrder matching array index', async () => {
    categoryFindUniqueMock.mockResolvedValue({
      id: 'category-1',
      menu: { id: 'menu-1', branchId: 'branch-1', status: MenuStatus.DRAFT },
      items: [{ id: 'item-a' }, { id: 'item-b' }],
    });

    const result = await service.execute(authUser, 'category-1', {
      orderedItemIds: ['item-b', 'item-a'],
    });

    expect(result).toEqual({ reorderedCount: 2 });
    const updateCalls = itemUpdateMock.mock.calls;
    expect(updateCalls[0][0]).toEqual({
      where: { id: 'item-b' },
      data: { sortOrder: 0 },
    });
    expect(updateCalls[1][0]).toEqual({
      where: { id: 'item-a' },
      data: { sortOrder: 1 },
    });
  });

  it('rejects when the id list does not match the category items', async () => {
    categoryFindUniqueMock.mockResolvedValue({
      id: 'category-1',
      menu: { id: 'menu-1', branchId: 'branch-1', status: MenuStatus.DRAFT },
      items: [{ id: 'item-a' }, { id: 'item-b' }],
    });

    await expect(
      service.execute(authUser, 'category-1', {
        orderedItemIds: ['item-a'],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it('rejects reordering on a published menu', async () => {
    categoryFindUniqueMock.mockResolvedValue({
      id: 'category-1',
      menu: {
        id: 'menu-1',
        branchId: 'branch-1',
        status: MenuStatus.PUBLISHED,
      },
      items: [{ id: 'item-a' }],
    });

    await expect(
      service.execute(authUser, 'category-1', {
        orderedItemIds: ['item-a'],
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects a category id that does not exist', async () => {
    categoryFindUniqueMock.mockResolvedValue(null);

    await expect(
      service.execute(authUser, 'missing-category', {
        orderedItemIds: ['item-a'],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

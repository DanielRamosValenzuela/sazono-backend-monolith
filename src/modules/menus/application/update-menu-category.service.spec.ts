import { BadRequestException, ConflictException } from '@nestjs/common';
import { MenuCategoryStatus, MenuStatus } from '@prisma/client';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import { LoginProfileType } from '../../auth/dto/login.dto';
import type { BranchAccessService } from '../../../common/branch-access/branch-access.service';
import { UpdateMenuCategoryService } from './update-menu-category.service';

describe('UpdateMenuCategoryService', () => {
  const categoryFindUniqueMock = jest.fn();
  const categoryUpdateMock = jest.fn();
  const prisma = {
    menuCategory: {
      findUnique: categoryFindUniqueMock,
      update: categoryUpdateMock,
    },
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

  let service: UpdateMenuCategoryService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new UpdateMenuCategoryService(prisma, branchAccessService);
  });

  it('archives a category on a draft menu', async () => {
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
    categoryUpdateMock.mockResolvedValue({
      id: 'category-1',
      menuId: 'menu-1',
      name: 'Postres',
      sortOrder: 2,
      status: MenuCategoryStatus.ARCHIVED,
    });

    const result = await service.execute(authUser, 'category-1', {
      status: MenuCategoryStatus.ARCHIVED,
    });

    expect(result.status).toBe(MenuCategoryStatus.ARCHIVED);
    const updateArgs = categoryUpdateMock.mock.calls[0][0] as {
      data: Record<string, unknown>;
    };
    expect(updateArgs.data).toEqual({ status: MenuCategoryStatus.ARCHIVED });
  });

  it('rejects edits on a published menu', async () => {
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
      service.execute(authUser, 'category-1', { name: 'Nuevo nombre' }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(categoryUpdateMock).not.toHaveBeenCalled();
  });

  it('rejects a category id that does not exist', async () => {
    categoryFindUniqueMock.mockResolvedValue(null);

    await expect(
      service.execute(authUser, 'missing-category', { name: 'X' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

import { BadRequestException, ConflictException } from '@nestjs/common';
import { MenuCategoryStatus, MenuStatus } from '@prisma/client';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import { LoginProfileType } from '../../auth/dto/login.dto';
import type { BranchAccessService } from '../../../common/branch-access/branch-access.service';
import { UpdateMenuCategoryService } from './update-menu-category.service';

describe('UpdateMenuCategoryService', () => {
  const categoryFindUniqueMock = jest.fn();
  const categoryUpdateMock = jest.fn();
  const categoryFindManyMock = jest.fn();
  const prisma = {
    menuCategory: {
      findUnique: categoryFindUniqueMock,
      findMany: categoryFindManyMock,
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

  describe('parentId', () => {
    beforeEach(() => {
      ensureAccessMock.mockResolvedValue({});
      categoryFindUniqueMock.mockResolvedValue({
        id: 'cafe',
        menuId: 'menu-1',
        menu: { id: 'menu-1', branchId: 'branch-1', status: MenuStatus.DRAFT },
      });
      categoryUpdateMock.mockImplementation(
        ({ data }: { data: Record<string, unknown> }) =>
          Promise.resolve({
            id: 'cafe',
            menuId: 'menu-1',
            name: 'Cafe',
            sortOrder: 0,
            status: MenuCategoryStatus.ACTIVE,
            parentId: null,
            ...data,
          }),
      );
      categoryFindManyMock.mockResolvedValue([
        { id: 'cafe', parentId: null },
        { id: 'calientes', parentId: 'cafe' },
        { id: 'postres', parentId: null },
      ]);
    });

    it('moves a category under another parent', async () => {
      const result = await service.execute(authUser, 'calientes', {
        parentId: 'postres',
      });

      expect(result.parentId).toBe('postres');
    });

    it('moves a category back to the root with null', async () => {
      const result = await service.execute(authUser, 'calientes', {
        parentId: null,
      });

      expect(result.parentId).toBeNull();
      expect(categoryFindManyMock).not.toHaveBeenCalled();
    });

    it('rejects a cycle', async () => {
      await expect(
        service.execute(authUser, 'cafe', { parentId: 'calientes' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(categoryUpdateMock).not.toHaveBeenCalled();
    });

    it('rejects a parent id that is the category itself', async () => {
      await expect(
        service.execute(authUser, 'cafe', { parentId: 'cafe' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('leaves parentId untouched when omitted', async () => {
      await service.execute(authUser, 'cafe', { name: 'Cafeteria' });

      const args = categoryUpdateMock.mock.calls[0][0] as {
        data: Record<string, unknown>;
      };

      expect(args.data).toEqual({ name: 'Cafeteria' });
    });
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

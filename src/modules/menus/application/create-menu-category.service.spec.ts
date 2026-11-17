import { BadRequestException, ConflictException } from '@nestjs/common';
import { MenuCategoryStatus, MenuStatus } from '@prisma/client';
import type { BranchAccessService } from '../../../common/branch-access/branch-access.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import { LoginProfileType } from '../../auth/dto/login.dto';
import { CreateMenuCategoryService } from './create-menu-category.service';

describe('CreateMenuCategoryService', () => {
  const menuFindUniqueMock = jest.fn();
  const categoryFindManyMock = jest.fn();
  const categoryAggregateMock = jest.fn();
  const categoryCreateMock = jest.fn();
  const prisma = {
    menu: { findUnique: menuFindUniqueMock },
    menuCategory: {
      findMany: categoryFindManyMock,
      aggregate: categoryAggregateMock,
      create: categoryCreateMock,
    },
  } as unknown as PrismaService;
  const branchAccessService = {
    ensureAccess: jest.fn().mockResolvedValue({}),
  } as unknown as BranchAccessService;
  const authUser = {
    sub: 'auth-1',
    profileType: LoginProfileType.STAFF,
    profileId: 'staff-1',
    restaurantId: 'restaurant-1',
  };
  const service = new CreateMenuCategoryService(prisma, branchAccessService);

  beforeEach(() => {
    jest.clearAllMocks();
    menuFindUniqueMock.mockResolvedValue({
      id: 'menu-1',
      branchId: 'branch-1',
      status: MenuStatus.DRAFT,
    });
    categoryAggregateMock.mockResolvedValue({ _max: { sortOrder: 4 } });
    categoryCreateMock.mockImplementation(
      ({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({
          id: 'new-category',
          status: MenuCategoryStatus.ACTIVE,
          ...data,
        }),
    );
  });

  it('creates a root category with parentId null', async () => {
    const result = await service.execute(authUser, 'menu-1', {
      name: ' Cafe ',
    });

    expect(result).toEqual({
      menuCategoryId: 'new-category',
      menuId: 'menu-1',
      name: 'Cafe',
      sortOrder: 5,
      status: MenuCategoryStatus.ACTIVE,
      parentId: null,
    });
    expect(categoryFindManyMock).not.toHaveBeenCalled();
  });

  it('creates a subcategory under a parent of the same menu', async () => {
    categoryFindManyMock.mockResolvedValue([{ id: 'cafe', parentId: null }]);

    const result = await service.execute(authUser, 'menu-1', {
      name: 'Bebidas Calientes',
      parentId: 'cafe',
    });

    expect(result.parentId).toBe('cafe');
    expect(categoryFindManyMock).toHaveBeenCalledWith({
      where: { menuId: 'menu-1' },
      select: { id: true, parentId: true },
    });
  });

  it('rejects a parent from another menu', async () => {
    categoryFindManyMock.mockResolvedValue([{ id: 'cafe', parentId: null }]);

    await expect(
      service.execute(authUser, 'menu-1', { name: 'X', parentId: 'foreign' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(categoryCreateMock).not.toHaveBeenCalled();
  });

  it('rejects a fourth level', async () => {
    categoryFindManyMock.mockResolvedValue([
      { id: 'a', parentId: null },
      { id: 'b', parentId: 'a' },
      { id: 'c', parentId: 'b' },
    ]);

    await expect(
      service.execute(authUser, 'menu-1', { name: 'X', parentId: 'c' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects edits on a non draft menu', async () => {
    menuFindUniqueMock.mockResolvedValue({
      id: 'menu-1',
      branchId: 'branch-1',
      status: MenuStatus.PUBLISHED,
    });

    await expect(
      service.execute(authUser, 'menu-1', { name: 'X', parentId: 'cafe' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

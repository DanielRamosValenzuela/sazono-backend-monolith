import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { MenuStatus } from '@prisma/client';
import type { BranchAccessService } from '../../../common/branch-access/branch-access.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import { LoginProfileType } from '../../auth/dto/login.dto';
import { UpdateMenuService } from './update-menu.service';

describe('UpdateMenuService', () => {
  const authUser = {
    sub: 'auth-1',
    profileType: LoginProfileType.STAFF,
    profileId: 'staff-1',
    restaurantId: 'restaurant-1',
  };

  const findUniqueMock = jest.fn();
  const updateMock = jest.fn();
  const settingsFindUniqueMock = jest.fn();
  const prisma = {
    menu: { findUnique: findUniqueMock, update: updateMock },
    branchSettings: { findUnique: settingsFindUniqueMock },
  } as unknown as PrismaService;

  const ensureAccessMock = jest.fn();
  const branchAccessService = {
    ensureAccess: ensureAccessMock,
  } as unknown as BranchAccessService;

  let service: UpdateMenuService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new UpdateMenuService(prisma, branchAccessService);
  });

  it('renames a menu of any status', async () => {
    findUniqueMock.mockResolvedValue({ branchId: 'branch-1' });
    ensureAccessMock.mockResolvedValue(undefined);
    settingsFindUniqueMock.mockResolvedValue({ defaultMenuId: 'menu-1' });
    updateMock.mockResolvedValue({
      id: 'menu-1',
      branchId: 'branch-1',
      name: 'Carta nueva',
      status: MenuStatus.PUBLISHED,
      version: 2,
      publishedAt: null,
      defaultLanguage: 'es',
      categories: [],
    });

    const result = await service.execute(authUser, 'menu-1', {
      name: ' Carta nueva ',
    });

    expect(updateMock.mock.calls[0][0]).toMatchObject({
      where: { id: 'menu-1' },
      data: { name: 'Carta nueva' },
    });
    expect(result.name).toBe('Carta nueva');
    expect(result.isDefaultMenu).toBe(true);
  });

  it('rejects users without access', async () => {
    findUniqueMock.mockResolvedValue({ branchId: 'branch-1' });
    ensureAccessMock.mockRejectedValue(new ForbiddenException());

    await expect(
      service.execute(authUser, 'menu-1', { name: 'x' }),
    ).rejects.toThrow(ForbiddenException);
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('rejects an unknown menu', async () => {
    findUniqueMock.mockResolvedValue(null);

    await expect(
      service.execute(authUser, 'nope', { name: 'x' }),
    ).rejects.toThrow(BadRequestException);
  });
});

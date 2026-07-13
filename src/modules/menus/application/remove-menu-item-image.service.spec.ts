import { BadRequestException, ConflictException } from '@nestjs/common';
import {
  MenuStatus,
  PreparationStationStatus,
  PreparationStationType,
} from '@prisma/client';
import { LoginProfileType } from '../../auth/dto/login.dto';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { SupabaseService } from '../../../common/supabase/supabase.service';
import type { BranchAccessService } from '../../../common/branch-access/branch-access.service';
import { RemoveMenuItemImageService } from './remove-menu-item-image.service';

describe('RemoveMenuItemImageService', () => {
  const itemFindUniqueMock = jest.fn();
  const itemFindUniqueOrThrowMock = jest.fn();
  const mediaDeleteManyMock = jest.fn();
  const removeMock = jest.fn();
  const fromMock = jest.fn(() => ({ remove: removeMock }));

  const prisma = {
    menuItem: {
      findUnique: itemFindUniqueMock,
      findUniqueOrThrow: itemFindUniqueOrThrowMock,
    },
    menuItemMedia: {
      deleteMany: mediaDeleteManyMock,
    },
  } as unknown as PrismaService;

  const supabaseService = {
    adminClient: {
      storage: {
        from: fromMock,
      },
    },
  } as unknown as SupabaseService;

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

  let service: RemoveMenuItemImageService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new RemoveMenuItemImageService(
      prisma,
      supabaseService,
      branchAccessService,
    );
    ensureAccessMock.mockResolvedValue({
      staffUserId: 'staff-1',
      branchId: 'branch-1',
      restaurantId: 'restaurant-1',
    });
    mediaDeleteManyMock.mockResolvedValue({ count: 1 });
    removeMock.mockResolvedValue({ error: null });
  });

  it('removes the stored object and the media row, returning imageUrl null', async () => {
    itemFindUniqueMock.mockResolvedValue({
      id: 'item-1',
      menuCategory: {
        id: 'category-1',
        menu: { id: 'menu-1', branchId: 'branch-1', status: MenuStatus.DRAFT },
      },
    });
    itemFindUniqueOrThrowMock.mockResolvedValue({
      id: 'item-1',
      menuCategoryId: 'category-1',
      name: 'Pisco Sour',
      description: null,
      price: { toString: () => '5900' },
      sku: null,
      itemType: 'DRINK',
      isAvailable: true,
      sortOrder: 0,
      media: [],
      preparationStation: {
        id: 'station-1',
        name: 'Barra',
        stationType: PreparationStationType.BAR,
        status: PreparationStationStatus.ACTIVE,
      },
    });

    const result = await service.execute(authUser, 'item-1');

    expect(mediaDeleteManyMock).toHaveBeenCalledWith({
      where: { menuItemId: 'item-1' },
    });
    expect(removeMock).toHaveBeenCalledWith(['menu-items/item-1/primary']);
    expect(result.imageUrl).toBeNull();
  });

  it('rejects removing on a published menu', async () => {
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

    await expect(service.execute(authUser, 'item-1')).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(mediaDeleteManyMock).not.toHaveBeenCalled();
  });

  it('rejects an item id that does not exist', async () => {
    itemFindUniqueMock.mockResolvedValue(null);

    await expect(
      service.execute(authUser, 'missing-item'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

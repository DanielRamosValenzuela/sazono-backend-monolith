import { BadRequestException, ConflictException } from '@nestjs/common';
import {
  MenuStatus,
  PreparationStationStatus,
  PreparationStationType,
} from '@prisma/client';
import { LoginProfileType } from '../../auth/dto/login.dto';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { SupabaseService } from '../../../common/supabase/supabase.service';
import type { MenusBranchAdminAccessService } from './menus-branch-admin-access.service';
import { UploadMenuItemImageService } from './upload-menu-item-image.service';

describe('UploadMenuItemImageService', () => {
  const itemFindUniqueMock = jest.fn();
  const itemFindUniqueOrThrowMock = jest.fn();
  const mediaDeleteManyMock = jest.fn();
  const mediaCreateMock = jest.fn();
  const transactionMock = jest.fn();
  const uploadMock = jest.fn();
  const getPublicUrlMock = jest.fn();
  const fromMock = jest.fn(() => ({
    upload: uploadMock,
    getPublicUrl: getPublicUrlMock,
  }));

  const prisma = {
    menuItem: {
      findUnique: itemFindUniqueMock,
      findUniqueOrThrow: itemFindUniqueOrThrowMock,
    },
    menuItemMedia: {
      deleteMany: mediaDeleteManyMock,
      create: mediaCreateMock,
    },
    $transaction: transactionMock,
  } as unknown as PrismaService;

  const supabaseService = {
    adminClient: {
      storage: {
        from: fromMock,
      },
    },
  } as unknown as SupabaseService;

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

  const validFile = {
    buffer: Buffer.from('fake-image-bytes'),
    mimetype: 'image/png',
    size: 1024,
  };

  let service: UploadMenuItemImageService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new UploadMenuItemImageService(
      prisma,
      supabaseService,
      menusBranchAdminAccessService,
    );
    ensureAdminAccessMock.mockResolvedValue({
      staffUserId: 'staff-1',
      branchId: 'branch-1',
      restaurantId: 'restaurant-1',
    });
    transactionMock.mockResolvedValue([]);
  });

  it('rejects when no file is provided', async () => {
    await expect(
      service.execute(authUser, 'item-1', undefined),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a disallowed mime type', async () => {
    await expect(
      service.execute(authUser, 'item-1', {
        buffer: Buffer.from('x'),
        mimetype: 'application/pdf',
        size: 100,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a file larger than 5MB', async () => {
    await expect(
      service.execute(authUser, 'item-1', {
        buffer: Buffer.from('x'),
        mimetype: 'image/png',
        size: 6 * 1024 * 1024,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects uploading on a published menu', async () => {
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
      service.execute(authUser, 'item-1', validFile),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(uploadMock).not.toHaveBeenCalled();
  });

  it('uploads to a fixed path, replaces existing media, and returns the public url', async () => {
    itemFindUniqueMock.mockResolvedValue({
      id: 'item-1',
      menuCategory: {
        id: 'category-1',
        menu: { id: 'menu-1', branchId: 'branch-1', status: MenuStatus.DRAFT },
      },
    });
    uploadMock.mockResolvedValue({ error: null });
    getPublicUrlMock.mockReturnValue({
      data: { publicUrl: 'https://cdn.example.com/menu-items/item-1/primary' },
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
      media: [{ url: 'https://cdn.example.com/menu-items/item-1/primary' }],
      preparationStation: {
        id: 'station-1',
        name: 'Barra',
        stationType: PreparationStationType.BAR,
        status: PreparationStationStatus.ACTIVE,
      },
    });

    const result = await service.execute(authUser, 'item-1', validFile);

    expect(fromMock).toHaveBeenCalledWith('menu-media');
    expect(uploadMock).toHaveBeenCalledWith(
      'menu-items/item-1/primary',
      validFile.buffer,
      { contentType: 'image/png', upsert: true },
    );
    expect(result.imageUrl).toBe(
      'https://cdn.example.com/menu-items/item-1/primary',
    );
  });

  it('surfaces a storage upload error as a BadRequestException', async () => {
    itemFindUniqueMock.mockResolvedValue({
      id: 'item-1',
      menuCategory: {
        id: 'category-1',
        menu: { id: 'menu-1', branchId: 'branch-1', status: MenuStatus.DRAFT },
      },
    });
    uploadMock.mockResolvedValue({ error: { message: 'bucket unavailable' } });

    await expect(
      service.execute(authUser, 'item-1', validFile),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(transactionMock).not.toHaveBeenCalled();
  });
});

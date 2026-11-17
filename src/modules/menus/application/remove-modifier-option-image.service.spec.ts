import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { LoginProfileType } from '../../auth/dto/login.dto';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { SupabaseService } from '../../../common/supabase/supabase.service';
import type { BranchAccessService } from '../../../common/branch-access/branch-access.service';
import { RemoveModifierOptionImageService } from './remove-modifier-option-image.service';

describe('RemoveModifierOptionImageService', () => {
  const findUniqueMock = jest.fn();
  const updateMock = jest.fn();
  const uploadMock = jest.fn();
  const removeMock = jest.fn();
  const getPublicUrlMock = jest.fn();
  const ensureAccessMock = jest.fn();

  const prisma = {
    modifierOption: { findUnique: findUniqueMock, update: updateMock },
  } as unknown as PrismaService;
  const supabaseService = {
    adminClient: {
      storage: {
        from: () => ({
          upload: uploadMock,
          remove: removeMock,
          getPublicUrl: getPublicUrlMock,
        }),
      },
    },
  } as unknown as SupabaseService;
  const branchAccessService = {
    ensureAccess: ensureAccessMock,
  } as unknown as BranchAccessService;

  const authUser = {
    sub: 'auth-1',
    profileType: LoginProfileType.STAFF,
    profileId: 'staff-1',
    restaurantId: 'restaurant-1',
  };

  const optionRow = {
    id: 'option-1',
    modifierGroup: { branchId: 'branch-1' },
  };
  const updatedRow = (imageUrl: string | null) => ({
    id: 'option-1',
    name: 'Almendras',
    priceDelta: { toString: () => '1500' },
    isAvailable: true,
    sortOrder: 0,
    imageUrl,
  });

  let service: RemoveModifierOptionImageService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new RemoveModifierOptionImageService(
      prisma,
      supabaseService,
      branchAccessService,
    );
    ensureAccessMock.mockResolvedValue({});
    findUniqueMock.mockResolvedValue(optionRow);
    uploadMock.mockResolvedValue({ error: null });
    removeMock.mockResolvedValue({ error: null });
    getPublicUrlMock.mockReturnValue({ data: { publicUrl: 'https://cdn/x' } });
  });

  it('nulls the column and removes the stored object', async () => {
    updateMock.mockResolvedValue(updatedRow(null));

    const result = await service.execute(authUser, 'option-1');

    expect(updateMock).toHaveBeenCalledWith({
      where: { id: 'option-1' },
      data: { imageUrl: null },
    });
    expect(removeMock).toHaveBeenCalledWith([
      'modifier-options/option-1/primary',
    ]);
    expect(result.imageUrl).toBeNull();
  });

  it('rejects an option that does not exist', async () => {
    findUniqueMock.mockResolvedValue(null);

    await expect(service.execute(authUser, 'missing')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('rejects a user without ADMIN access to the branch', async () => {
    ensureAccessMock.mockRejectedValue(new ForbiddenException());

    await expect(service.execute(authUser, 'option-1')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(updateMock).not.toHaveBeenCalled();
    expect(removeMock).not.toHaveBeenCalled();
  });
});

import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { LoginProfileType } from '../../auth/dto/login.dto';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { SupabaseService } from '../../../common/supabase/supabase.service';
import type { BranchAccessService } from '../../../common/branch-access/branch-access.service';
import { UploadModifierOptionImageService } from './upload-modifier-option-image.service';

describe('UploadModifierOptionImageService', () => {
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

  let service: UploadModifierOptionImageService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new UploadModifierOptionImageService(
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

  const validFile = {
    buffer: Buffer.from('fake'),
    mimetype: 'image/png',
    size: 1024,
  };

  it('uploads with upsert and stores the public url', async () => {
    updateMock.mockImplementation(({ data }: { data: { imageUrl: string } }) =>
      Promise.resolve(updatedRow(data.imageUrl)),
    );

    const result = await service.execute(authUser, 'option-1', validFile);

    expect(uploadMock).toHaveBeenCalledWith(
      'modifier-options/option-1/primary',
      validFile.buffer,
      { contentType: 'image/png', upsert: true },
    );
    expect(result.modifierOptionId).toBe('option-1');
    expect(result.imageUrl).toMatch(/^https:\/\/cdn\/x\?v=\d+$/);
  });

  it('rejects a missing file', async () => {
    await expect(
      service.execute(authUser, 'option-1', undefined),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects an unsupported mime type', async () => {
    await expect(
      service.execute(authUser, 'option-1', {
        ...validFile,
        mimetype: 'image/gif',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(uploadMock).not.toHaveBeenCalled();
  });

  it('rejects a file over 5MB', async () => {
    await expect(
      service.execute(authUser, 'option-1', {
        ...validFile,
        size: 5 * 1024 * 1024 + 1,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(uploadMock).not.toHaveBeenCalled();
  });

  it('rejects an option that does not exist', async () => {
    findUniqueMock.mockResolvedValue(null);

    await expect(
      service.execute(authUser, 'missing', validFile),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a user without ADMIN access to the branch', async () => {
    ensureAccessMock.mockRejectedValue(new ForbiddenException());

    await expect(
      service.execute(authUser, 'option-1', validFile),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(uploadMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('does not touch the column when the storage upload fails', async () => {
    uploadMock.mockResolvedValue({ error: { message: 'boom' } });

    await expect(
      service.execute(authUser, 'option-1', validFile),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(updateMock).not.toHaveBeenCalled();
  });
});

import { BadRequestException } from '@nestjs/common';
import { ModifierSelectionType } from '@prisma/client';
import type { BranchAccessService } from '../../../common/branch-access/branch-access.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import { LoginProfileType } from '../../auth/dto/login.dto';
import { CreateModifierGroupService } from './create-modifier-group.service';

describe('CreateModifierGroupService', () => {
  const authUser = {
    sub: 'auth-1',
    profileType: LoginProfileType.STAFF,
    profileId: 'staff-1',
    restaurantId: 'restaurant-1',
  };
  const optionFindUniqueMock = jest.fn();
  const groupCreateMock = jest.fn();
  const prisma = {
    modifierOption: { findUnique: optionFindUniqueMock },
    modifierGroup: { create: groupCreateMock },
  } as unknown as PrismaService;
  const branchAccessService = {
    ensureAccess: jest.fn().mockResolvedValue(undefined),
  } as unknown as BranchAccessService;
  const service = new CreateModifierGroupService(prisma, branchAccessService);

  const dto = {
    branchId: 'branch-1',
    name: 'Tipo',
    selectionType: ModifierSelectionType.ONE,
    parentOptionId: 'option-1',
  };

  const parentWithAncestors = (groupCount: number, branchId = 'branch-1') => {
    let modifierGroup: Record<string, unknown> = {
      id: 'g1',
      branchId,
      parentOption: null,
    };

    for (let level = 2; level <= groupCount; level += 1) {
      modifierGroup = {
        id: `g${level}`,
        branchId,
        parentOption: { modifierGroup },
      };
    }

    return { id: 'option-1', modifierGroup };
  };

  beforeEach(() => {
    jest.clearAllMocks();
    groupCreateMock.mockImplementation(({ data }: { data: object }) => ({
      id: 'group-new',
      sortOrder: 0,
      minSelect: 0,
      maxSelect: null,
      isRequired: false,
      options: [],
      ...data,
    }));
  });

  it('creates a child group with the parent option and its depth', async () => {
    optionFindUniqueMock.mockResolvedValue(parentWithAncestors(2));

    const result = await service.execute(authUser, dto);

    expect(groupCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ parentOptionId: 'option-1' }),
      }),
    );
    expect(result).toMatchObject({ parentOptionId: 'option-1', depth: 3 });
  });

  it('creates root groups at depth 1 without looking up a parent', async () => {
    const result = await service.execute(authUser, {
      ...dto,
      parentOptionId: undefined,
    });

    expect(optionFindUniqueMock).not.toHaveBeenCalled();
    expect(result).toMatchObject({ parentOptionId: null, depth: 1 });
  });

  it('rejects a fourth level', async () => {
    optionFindUniqueMock.mockResolvedValue(parentWithAncestors(3));

    await expect(service.execute(authUser, dto)).rejects.toThrow(
      'como maximo 3 niveles',
    );
    expect(groupCreateMock).not.toHaveBeenCalled();
  });

  it('rejects a parent option of another branch or a missing one', async () => {
    optionFindUniqueMock.mockResolvedValue(parentWithAncestors(1, 'branch-2'));
    await expect(service.execute(authUser, dto)).rejects.toBeInstanceOf(
      BadRequestException,
    );

    optionFindUniqueMock.mockResolvedValue(null);
    await expect(service.execute(authUser, dto)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});

import { BadRequestException } from '@nestjs/common';
import type { BranchAccessService } from '../../../common/branch-access/branch-access.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import { LoginProfileType } from '../../auth/dto/login.dto';
import { SetMenuItemModifierGroupsService } from './set-menu-item-modifier-groups.service';

describe('SetMenuItemModifierGroupsService', () => {
  const authUser = {
    sub: 'auth-1',
    profileType: LoginProfileType.STAFF,
    profileId: 'staff-1',
    restaurantId: 'restaurant-1',
  };
  const groupFindManyMock = jest.fn();
  const transactionMock = jest.fn();
  const prisma = {
    menuItem: {
      findUnique: jest.fn().mockResolvedValue({
        menuCategory: { menu: { branchId: 'branch-1' } },
      }),
    },
    modifierGroup: { findMany: groupFindManyMock },
    menuItemModifierGroup: { deleteMany: jest.fn(), createMany: jest.fn() },
    $transaction: transactionMock,
  } as unknown as PrismaService;
  const service = new SetMenuItemModifierGroupsService(prisma, {
    ensureAccess: jest.fn().mockResolvedValue(undefined),
  } as unknown as BranchAccessService);

  const record = (id: string, parentOptionId: string | null) => ({
    id,
    branchId: 'branch-1',
    parentOptionId,
    name: id,
    selectionType: 'ONE',
    minSelect: 0,
    maxSelect: null,
    isRequired: false,
    sortOrder: 0,
    options: [],
  });

  beforeEach(() => jest.clearAllMocks());

  it('rejects child groups: they are attached from their parent option', async () => {
    groupFindManyMock.mockResolvedValue([record('child', 'option-1')]);

    await expect(
      service.execute(authUser, 'item-1', { modifierGroupIds: ['child'] }),
    ).rejects.toThrow(BadRequestException);
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it('links root groups', async () => {
    groupFindManyMock.mockResolvedValue([record('root', null)]);

    const result = await service.execute(authUser, 'item-1', {
      modifierGroupIds: ['root'],
    });

    expect(result).toHaveLength(1);
    expect(transactionMock).toHaveBeenCalledTimes(1);
  });
});

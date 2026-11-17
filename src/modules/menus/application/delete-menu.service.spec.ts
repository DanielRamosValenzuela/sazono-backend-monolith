import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { MenuStatus } from '@prisma/client';
import type { BranchAccessService } from '../../../common/branch-access/branch-access.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import { LoginProfileType } from '../../auth/dto/login.dto';
import { DeleteMenuService } from './delete-menu.service';

describe('DeleteMenuService', () => {
  const authUser = {
    sub: 'auth-1',
    profileType: LoginProfileType.STAFF,
    profileId: 'staff-1',
    restaurantId: 'restaurant-1',
  };

  const findUniqueMock = jest.fn();
  const transactionMock = jest.fn();
  const prisma = {
    menu: { findUnique: findUniqueMock },
    $transaction: transactionMock,
  } as unknown as PrismaService;

  const ensureAccessMock = jest.fn();
  const branchAccessService = {
    ensureAccess: ensureAccessMock,
  } as unknown as BranchAccessService;

  const calls: string[] = [];
  const translationDeleteManyMock = jest.fn();
  const categoryDeleteManyMock = jest.fn();
  const menuDeleteMock = jest.fn();

  const menuWith = (status: MenuStatus) => ({
    id: 'menu-1',
    branchId: 'branch-1',
    status,
    categories: [
      { id: 'grandchild', parentId: 'child', items: [{ id: 'item-2' }] },
      { id: 'root', parentId: null, items: [{ id: 'item-1' }] },
      { id: 'child', parentId: 'root', items: [] },
      { id: 'root-2', parentId: null, items: [] },
    ],
  });

  let service: DeleteMenuService;

  beforeEach(() => {
    jest.clearAllMocks();
    calls.length = 0;
    service = new DeleteMenuService(prisma, branchAccessService);
    ensureAccessMock.mockResolvedValue(undefined);
    translationDeleteManyMock.mockImplementation(() => {
      calls.push('translations');
      return Promise.resolve({ count: 0 });
    });
    categoryDeleteManyMock.mockImplementation(
      (args: { where: { id: { in: string[] } } }) => {
        calls.push(`categories:${args.where.id.in.join(',')}`);
        return Promise.resolve({ count: args.where.id.in.length });
      },
    );
    menuDeleteMock.mockImplementation(() => {
      calls.push('menu');
      return Promise.resolve({});
    });
    transactionMock.mockImplementation(
      (callback: (tx: unknown) => Promise<unknown>) =>
        callback({
          translation: { deleteMany: translationDeleteManyMock },
          menuCategory: { deleteMany: categoryDeleteManyMock },
          menu: { delete: menuDeleteMock },
        }),
    );
  });

  it('deletes a draft: translations, then categories deepest first, then the menu', async () => {
    findUniqueMock.mockResolvedValue(menuWith(MenuStatus.DRAFT));

    await service.execute(authUser, 'menu-1');

    expect(ensureAccessMock).toHaveBeenCalledWith(authUser, 'branch-1', [
      'ADMIN',
    ]);
    expect(transactionMock).toHaveBeenCalledTimes(1);
    expect(calls).toEqual([
      'translations',
      'categories:grandchild',
      'categories:child',
      'categories:root,root-2',
      'menu',
    ]);
    expect(menuDeleteMock).toHaveBeenCalledWith({ where: { id: 'menu-1' } });
    expect(translationDeleteManyMock.mock.calls[0][0]).toMatchObject({
      where: {
        OR: [
          { entityId: { in: ['grandchild', 'root', 'child', 'root-2'] } },
          { entityId: { in: ['item-2', 'item-1'] } },
        ],
      },
    });
  });

  it.each([MenuStatus.PUBLISHED, MenuStatus.ARCHIVED])(
    'rejects a %s menu with 409',
    async (status) => {
      findUniqueMock.mockResolvedValue(menuWith(status));

      await expect(service.execute(authUser, 'menu-1')).rejects.toThrow(
        ConflictException,
      );
      expect(transactionMock).not.toHaveBeenCalled();
    },
  );

  it('rejects users without access to the branch', async () => {
    findUniqueMock.mockResolvedValue(menuWith(MenuStatus.DRAFT));
    ensureAccessMock.mockRejectedValue(new ForbiddenException());

    await expect(service.execute(authUser, 'menu-1')).rejects.toThrow(
      ForbiddenException,
    );
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it('rejects an unknown menu', async () => {
    findUniqueMock.mockResolvedValue(null);

    await expect(service.execute(authUser, 'nope')).rejects.toThrow(
      BadRequestException,
    );
  });
});

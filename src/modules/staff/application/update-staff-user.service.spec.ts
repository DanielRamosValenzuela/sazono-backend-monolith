import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { BranchRoleStatus, Role, StaffUserStatus } from '@prisma/client';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { AuthProvider } from '../../auth/application/ports/auth-provider.port';
import { UpdateStaffUserService } from './update-staff-user.service';
import type { BranchAccessService } from '../../../common/branch-access/branch-access.service';
import { LoginProfileType } from '../../auth/dto/login.dto';

type StaffUserRecord = {
  id: string;
  authUserId: string;
  restaurantId: string;
  firstName: string;
  lastName: string;
  status: StaffUserStatus;
  branchRoles: Array<{
    branchId: string;
    role: Role;
    branch: {
      id: string;
      name: string;
    };
  }>;
};

type TransactionClient = {
  staffUser: {
    update: jest.Mock<Promise<{ id: string }>, [unknown]>;
    findUniqueOrThrow: jest.Mock<Promise<StaffUserRecord>, [unknown]>;
  };
  staffUserBranchRole: {
    updateMany: jest.Mock<Promise<{ count: number }>, [unknown]>;
    upsert: jest.Mock<Promise<{ id: string }>, [unknown]>;
  };
};

type TransactionCallback = (
  transactionClient: TransactionClient,
) => Promise<StaffUserRecord>;

describe('UpdateStaffUserService', () => {
  const staffFindFirstMock = jest.fn();
  const staffCountMock = jest.fn();
  const branchFindManyMock = jest.fn();
  const transactionMock = jest.fn();

  const prisma = {
    staffUser: {
      findFirst: staffFindFirstMock,
      count: staffCountMock,
    },
    branch: {
      findMany: branchFindManyMock,
    },
    $transaction: transactionMock,
  } as unknown as PrismaService;

  const getStaffContextMock = jest.fn();
  const branchAccessService = {
    getStaffContext: getStaffContextMock,
  } as unknown as BranchAccessService;

  const getUserByIdMock = jest.fn();
  const authProvider = {
    getUserById: getUserByIdMock,
  } as unknown as AuthProvider;

  const authUser = {
    sub: 'auth-admin',
    profileType: LoginProfileType.STAFF,
    profileId: 'staff-admin-1',
    restaurantId: 'restaurant-1',
  };

  const adminContext = {
    staffUserId: 'staff-admin-1',
    restaurantId: 'restaurant-1',
    adminBranchIds: new Set(['branch-1']),
  };

  let service: UpdateStaffUserService;

  const staffUserUpdateMock = jest
    .fn<Promise<{ id: string }>, [unknown]>()
    .mockResolvedValue({ id: 'staff-1' });
  const branchRoleUpdateManyMock = jest
    .fn<Promise<{ count: number }>, [unknown]>()
    .mockResolvedValue({ count: 1 });
  const branchRoleUpsertMock = jest
    .fn<Promise<{ id: string }>, [unknown]>()
    .mockResolvedValue({ id: 'branch-role-1' });
  const findUniqueOrThrowMock = jest.fn<Promise<StaffUserRecord>, [unknown]>();

  const setupTransaction = () => {
    transactionMock.mockImplementation((callback: TransactionCallback) =>
      callback({
        staffUser: {
          update: staffUserUpdateMock,
          findUniqueOrThrow: findUniqueOrThrowMock,
        },
        staffUserBranchRole: {
          updateMany: branchRoleUpdateManyMock,
          upsert: branchRoleUpsertMock,
        },
      }),
    );
  };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new UpdateStaffUserService(
      prisma,
      branchAccessService,
      authProvider,
    );
    getStaffContextMock.mockResolvedValue(adminContext);
  });

  it('updates names and replaces branch roles as the full set', async () => {
    staffFindFirstMock.mockResolvedValue({
      id: 'staff-1',
      authUserId: 'auth-1',
      restaurantId: 'restaurant-1',
      firstName: 'Ana',
      lastName: 'Diaz',
      status: StaffUserStatus.ACTIVE,
      branchRoles: [{ branchId: 'branch-1', role: Role.WAITER }],
    });
    staffCountMock.mockResolvedValue(1);
    branchFindManyMock.mockResolvedValue([{ id: 'branch-1' }]);
    findUniqueOrThrowMock.mockResolvedValue({
      id: 'staff-1',
      authUserId: 'auth-1',
      restaurantId: 'restaurant-1',
      firstName: 'Ana Maria',
      lastName: 'Diaz',
      status: StaffUserStatus.ACTIVE,
      branchRoles: [
        {
          branchId: 'branch-1',
          role: Role.CASHIER,
          branch: {
            id: 'branch-1',
            name: 'Providencia',
          },
        },
      ],
    });
    getUserByIdMock.mockResolvedValue({
      authUserId: 'auth-1',
      email: 'ana@sazonodemo.cl',
    });
    setupTransaction();

    const result = await service.execute(authUser, 'staff-1', {
      firstName: 'Ana Maria',
      branchRoles: [{ branchId: 'branch-1', role: Role.CASHIER }],
    });

    expect(branchRoleUpdateManyMock).toHaveBeenCalledWith({
      where: {
        staffUserId: 'staff-1',
      },
      data: {
        status: BranchRoleStatus.INACTIVE,
      },
    });
    expect(branchRoleUpsertMock).toHaveBeenCalledTimes(1);
    expect(result.email).toBe('ana@sazonodemo.cl');
    expect(result.firstName).toBe('Ana Maria');
    expect(result.branchRoles).toEqual([
      {
        branchId: 'branch-1',
        branchName: 'Providencia',
        role: Role.CASHIER,
      },
    ]);
  });

  it('rejects an update without any field', async () => {
    await expect(
      service.execute(authUser, 'staff-1', {}),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('returns 404 when the staff user belongs to another restaurant', async () => {
    staffFindFirstMock.mockResolvedValue(null);

    await expect(
      service.execute(authUser, 'staff-external', {
        firstName: 'Otro',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects disabling your own staff account', async () => {
    staffFindFirstMock.mockResolvedValue({
      id: 'staff-admin-1',
      authUserId: 'auth-admin',
      restaurantId: 'restaurant-1',
      firstName: 'Admin',
      lastName: 'Uno',
      status: StaffUserStatus.ACTIVE,
      branchRoles: [{ branchId: 'branch-1', role: Role.ADMIN }],
    });

    await expect(
      service.execute(authUser, 'staff-admin-1', {
        status: StaffUserStatus.DISABLED,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects removing your own last ADMIN role', async () => {
    staffFindFirstMock.mockResolvedValue({
      id: 'staff-admin-1',
      authUserId: 'auth-admin',
      restaurantId: 'restaurant-1',
      firstName: 'Admin',
      lastName: 'Uno',
      status: StaffUserStatus.ACTIVE,
      branchRoles: [{ branchId: 'branch-1', role: Role.ADMIN }],
    });
    branchFindManyMock.mockResolvedValue([{ id: 'branch-1' }]);

    await expect(
      service.execute(authUser, 'staff-admin-1', {
        branchRoles: [{ branchId: 'branch-1', role: Role.WAITER }],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects branch assignments outside admin scope', async () => {
    staffFindFirstMock.mockResolvedValue({
      id: 'staff-1',
      authUserId: 'auth-1',
      restaurantId: 'restaurant-1',
      firstName: 'Ana',
      lastName: 'Diaz',
      status: StaffUserStatus.ACTIVE,
      branchRoles: [{ branchId: 'branch-1', role: Role.WAITER }],
    });

    await expect(
      service.execute(authUser, 'staff-1', {
        branchRoles: [{ branchId: 'branch-2', role: Role.WAITER }],
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects leaving the restaurant without any active ADMIN', async () => {
    staffFindFirstMock.mockResolvedValue({
      id: 'staff-2',
      authUserId: 'auth-2',
      restaurantId: 'restaurant-1',
      firstName: 'Bruno',
      lastName: 'Perez',
      status: StaffUserStatus.ACTIVE,
      branchRoles: [{ branchId: 'branch-1', role: Role.ADMIN }],
    });
    branchFindManyMock.mockResolvedValue([{ id: 'branch-1' }]);
    staffCountMock.mockResolvedValue(0);

    await expect(
      service.execute(authUser, 'staff-2', {
        branchRoles: [{ branchId: 'branch-1', role: Role.WAITER }],
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('allows disabling another staff when other active admins remain', async () => {
    staffFindFirstMock.mockResolvedValue({
      id: 'staff-2',
      authUserId: 'auth-2',
      restaurantId: 'restaurant-1',
      firstName: 'Bruno',
      lastName: 'Perez',
      status: StaffUserStatus.ACTIVE,
      branchRoles: [{ branchId: 'branch-1', role: Role.WAITER }],
    });
    staffCountMock.mockResolvedValue(1);
    findUniqueOrThrowMock.mockResolvedValue({
      id: 'staff-2',
      authUserId: 'auth-2',
      restaurantId: 'restaurant-1',
      firstName: 'Bruno',
      lastName: 'Perez',
      status: StaffUserStatus.DISABLED,
      branchRoles: [
        {
          branchId: 'branch-1',
          role: Role.WAITER,
          branch: {
            id: 'branch-1',
            name: 'Providencia',
          },
        },
      ],
    });
    getUserByIdMock.mockResolvedValue(null);
    setupTransaction();

    const result = await service.execute(authUser, 'staff-2', {
      status: StaffUserStatus.DISABLED,
    });

    expect(result.status).toBe(StaffUserStatus.DISABLED);
    expect(result.email).toBeNull();
    expect(branchRoleUpdateManyMock).not.toHaveBeenCalled();
  });
});

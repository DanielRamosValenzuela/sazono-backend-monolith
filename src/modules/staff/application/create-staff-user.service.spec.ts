import { ForbiddenException } from '@nestjs/common';
import { Role, StaffUserStatus } from '@prisma/client';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { AuthProvider } from '../../auth/application/ports/auth-provider.port';
import { CreateStaffUserService } from './create-staff-user.service';
import type { BranchAccessService } from '../../../common/branch-access/branch-access.service';
import { LoginProfileType } from '../../auth/dto/login.dto';

type TransactionClient = {
  staffUser: {
    create: jest.Mock<Promise<{ id: string }>, [unknown]>;
    findUniqueOrThrow: jest.Mock<
      Promise<{
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
      }>,
      [unknown]
    >;
  };
  staffUserBranchRole: {
    createMany: jest.Mock<Promise<{ count: number }>, [unknown]>;
  };
};

type TransactionCallback = (transactionClient: TransactionClient) => Promise<{
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
}>;

describe('CreateStaffUserService', () => {
  const branchFindManyMock = jest.fn();
  const staffFindFirstMock = jest.fn();
  const transactionMock = jest.fn();

  const prisma = {
    branch: {
      findMany: branchFindManyMock,
    },
    staffUser: {
      findFirst: staffFindFirstMock,
    },
    $transaction: transactionMock,
  } as unknown as PrismaService;

  const getStaffContextMock = jest.fn();
  const branchAccessService = {
    getStaffContext: getStaffContextMock,
  } as unknown as BranchAccessService;

  const findUserByEmailMock = jest.fn();
  const createUserMock = jest.fn();
  const deleteUserMock = jest.fn();
  const authProvider = {
    findUserByEmail: findUserByEmailMock,
    createUser: createUserMock,
    deleteUser: deleteUserMock,
  } as unknown as AuthProvider;

  let service: CreateStaffUserService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new CreateStaffUserService(
      prisma,
      branchAccessService,
      authProvider,
    );
  });

  it('creates a new auth identity and staff profile', async () => {
    getStaffContextMock.mockResolvedValue({
      staffUserId: 'staff-admin-1',
      restaurantId: 'restaurant-1',
      adminBranchIds: new Set(['branch-1']),
    });
    branchFindManyMock.mockResolvedValue([
      { id: 'branch-1', name: 'Providencia' },
    ]);
    findUserByEmailMock.mockResolvedValue(null);
    createUserMock.mockResolvedValue({
      authUserId: 'auth-1',
      email: 'ana@sazonodemo.cl',
    });
    staffFindFirstMock.mockResolvedValue(null);
    const createStaffUserMock = jest
      .fn<Promise<{ id: string }>, [unknown]>()
      .mockResolvedValue({
        id: 'staff-1',
      });
    const findUniqueOrThrowMock = jest
      .fn<
        Promise<{
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
        }>,
        [unknown]
      >()
      .mockResolvedValue({
        id: 'staff-1',
        authUserId: 'auth-1',
        restaurantId: 'restaurant-1',
        firstName: 'Ana',
        lastName: 'Diaz',
        status: StaffUserStatus.ACTIVE,
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
    const createManyMock = jest
      .fn<Promise<{ count: number }>, [unknown]>()
      .mockResolvedValue({ count: 1 });

    transactionMock.mockImplementation((callback: TransactionCallback) =>
      callback({
        staffUser: {
          create: createStaffUserMock,
          findUniqueOrThrow: findUniqueOrThrowMock,
        },
        staffUserBranchRole: {
          createMany: createManyMock,
        },
      }),
    );

    const result = await service.execute(
      {
        sub: 'auth-admin',
        profileType: LoginProfileType.STAFF,
        profileId: 'staff-admin-1',
        restaurantId: 'restaurant-1',
      },
      {
        email: 'Ana@SazonoDemo.cl',
        password: 'Temporal123!',
        firstName: 'Ana',
        lastName: 'Diaz',
        branchRoles: [{ branchId: 'branch-1', role: Role.WAITER }],
      },
    );

    expect(createUserMock).toHaveBeenCalled();
    expect(result.email).toBe('ana@sazonodemo.cl');
    expect(result.branchRoles).toHaveLength(1);
  });

  it('reuses an existing auth identity when the email already exists', async () => {
    getStaffContextMock.mockResolvedValue({
      staffUserId: 'staff-admin-1',
      restaurantId: 'restaurant-1',
      adminBranchIds: new Set(['branch-1']),
    });
    branchFindManyMock.mockResolvedValue([
      { id: 'branch-1', name: 'Providencia' },
    ]);
    findUserByEmailMock.mockResolvedValue({
      authUserId: 'auth-existing',
      email: 'caja@sazonodemo.cl',
    });
    staffFindFirstMock.mockResolvedValue(null);
    const createStaffUserMock = jest
      .fn<Promise<{ id: string }>, [unknown]>()
      .mockResolvedValue({
        id: 'staff-2',
      });
    const findUniqueOrThrowMock = jest
      .fn<
        Promise<{
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
        }>,
        [unknown]
      >()
      .mockResolvedValue({
        id: 'staff-2',
        authUserId: 'auth-existing',
        restaurantId: 'restaurant-1',
        firstName: 'Camila',
        lastName: 'Rojas',
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
    const createManyMock = jest
      .fn<Promise<{ count: number }>, [unknown]>()
      .mockResolvedValue({ count: 1 });

    transactionMock.mockImplementation((callback: TransactionCallback) =>
      callback({
        staffUser: {
          create: createStaffUserMock,
          findUniqueOrThrow: findUniqueOrThrowMock,
        },
        staffUserBranchRole: {
          createMany: createManyMock,
        },
      }),
    );

    const result = await service.execute(
      {
        sub: 'auth-admin',
        profileType: LoginProfileType.STAFF,
        profileId: 'staff-admin-1',
        restaurantId: 'restaurant-1',
      },
      {
        email: 'caja@sazonodemo.cl',
        firstName: 'Camila',
        lastName: 'Rojas',
        branchRoles: [{ branchId: 'branch-1', role: Role.CASHIER }],
      },
    );

    expect(createUserMock).not.toHaveBeenCalled();
    expect(result.authUserId).toBe('auth-existing');
  });

  it('rejects branch assignments outside admin scope', async () => {
    getStaffContextMock.mockResolvedValue({
      staffUserId: 'staff-admin-1',
      restaurantId: 'restaurant-1',
      adminBranchIds: new Set(['branch-1']),
    });

    await expect(
      service.execute(
        {
          sub: 'auth-admin',
          profileType: LoginProfileType.STAFF,
          profileId: 'staff-admin-1',
          restaurantId: 'restaurant-1',
        },
        {
          email: 'otro@sazonodemo.cl',
          password: 'Temporal123!',
          firstName: 'Otro',
          lastName: 'Usuario',
          branchRoles: [{ branchId: 'branch-2', role: Role.WAITER }],
        },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});

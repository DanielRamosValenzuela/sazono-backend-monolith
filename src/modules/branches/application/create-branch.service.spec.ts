import { ForbiddenException } from '@nestjs/common';
import { Role, StaffUserStatus } from '@prisma/client';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import { CreateBranchService } from './create-branch.service';
import { LoginProfileType } from '../../auth/dto/login.dto';

type StaffLookupResult = {
  id: string;
  restaurantId: string;
  status: StaffUserStatus;
  branchRoles: Array<{ role: Role }>;
};

type BranchCreationResult = {
  id: string;
  restaurantId: string;
  name: string;
  address: string | null;
  settings: {
    qrOrderingEnabled: boolean;
    qrPaymentMode: string;
    splitBillEnabled: boolean;
    partialDeliveryEnabled: boolean;
  };
};

type TransactionClient = {
  branch: {
    create: jest.Mock<Promise<BranchCreationResult>, [unknown]>;
  };
  staffUserBranchRole: {
    create: jest.Mock<Promise<{ id: string }>, [unknown]>;
  };
};

type TransactionCallback = (
  transactionClient: TransactionClient,
) => Promise<BranchCreationResult>;

describe('CreateBranchService', () => {
  const staffUserFindFirstMock = jest.fn<
    Promise<StaffLookupResult | null>,
    [unknown]
  >();
  const transactionMock = jest.fn<
    Promise<BranchCreationResult>,
    [TransactionCallback]
  >();

  const restaurantFindUniqueOrThrowMock = jest.fn();

  const prisma = {
    staffUser: {
      findFirst: staffUserFindFirstMock,
    },
    restaurant: {
      findUniqueOrThrow: restaurantFindUniqueOrThrowMock,
    },
    $transaction: transactionMock,
  } as unknown as PrismaService;

  let service: CreateBranchService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new CreateBranchService(prisma);
  });

  it('creates a branch and assigns admin role during bootstrap state', async () => {
    staffUserFindFirstMock.mockResolvedValue({
      id: 'staff-1',
      restaurantId: 'restaurant-1',
      status: StaffUserStatus.ACTIVE,
      branchRoles: [],
    });
    restaurantFindUniqueOrThrowMock.mockResolvedValue({
      branchQuota: 5,
      _count: { branches: 0 },
    });

    const createBranchMock = jest
      .fn<Promise<BranchCreationResult>, [unknown]>()
      .mockResolvedValue({
        id: 'branch-1',
        restaurantId: 'restaurant-1',
        name: 'Providencia',
        address: 'Av. Providencia 1234',
        settings: {
          qrOrderingEnabled: true,
          qrPaymentMode: 'prepaid_order',
          splitBillEnabled: true,
          partialDeliveryEnabled: true,
        },
      });
    const createBranchRoleMock = jest
      .fn<Promise<{ id: string }>, [unknown]>()
      .mockResolvedValue({
        id: 'role-1',
      });

    transactionMock.mockImplementation((callback) =>
      callback({
        branch: {
          create: createBranchMock,
        },
        staffUserBranchRole: {
          create: createBranchRoleMock,
        },
      }),
    );

    const result = await service.execute(
      {
        sub: 'auth-1',
        profileType: LoginProfileType.STAFF,
        profileId: 'staff-1',
        restaurantId: 'restaurant-1',
      },
      {
        name: 'Providencia',
        address: 'Av. Providencia 1234',
      },
    );

    expect(result.branchId).toBe('branch-1');
    expect(result.assignedRole).toBe(Role.ADMIN);
  });

  it('rejects a staff user without admin rights when branch roles already exist', async () => {
    staffUserFindFirstMock.mockResolvedValue({
      id: 'staff-2',
      restaurantId: 'restaurant-1',
      status: StaffUserStatus.ACTIVE,
      branchRoles: [{ role: Role.WAITER }],
    });

    await expect(
      service.execute(
        {
          sub: 'auth-2',
          profileType: LoginProfileType.STAFF,
          profileId: 'staff-2',
          restaurantId: 'restaurant-1',
        },
        {
          name: 'Las Condes',
        },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects when the restaurant already reached its branch quota', async () => {
    staffUserFindFirstMock.mockResolvedValue({
      id: 'staff-3',
      restaurantId: 'restaurant-1',
      status: StaffUserStatus.ACTIVE,
      branchRoles: [{ role: Role.ADMIN }],
    });
    restaurantFindUniqueOrThrowMock.mockResolvedValue({
      branchQuota: 1,
      _count: { branches: 1 },
    });

    await expect(
      service.execute(
        {
          sub: 'auth-3',
          profileType: LoginProfileType.STAFF,
          profileId: 'staff-3',
          restaurantId: 'restaurant-1',
        },
        {
          name: 'Vitacura',
        },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(transactionMock).not.toHaveBeenCalled();
  });
});

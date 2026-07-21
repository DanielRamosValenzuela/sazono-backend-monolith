import { BranchStatus } from '@prisma/client';
import {
  BranchAccessService,
  type StaffContext,
} from '../../../common/branch-access/branch-access.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import { LoginProfileType } from '../../auth/dto/login.dto';
import type { JwtPayload } from '../../auth/interfaces/jwt-payload.interface';
import { ListBranchesService } from './list-branches.service';

type BranchLookupResult = {
  id: string;
  restaurantId: string;
  name: string;
  address: string | null;
  status: BranchStatus;
  createdAt: Date;
  updatedAt: Date;
  settings: {
    branchId: string;
    qrOrderingEnabled: boolean;
    qrPaymentMode: string;
    splitBillEnabled: boolean;
    partialDeliveryEnabled: boolean;
    defaultMenuId: string | null;
    createdAt: Date;
    updatedAt: Date;
  } | null;
};

describe('ListBranchesService', () => {
  const branchFindManyMock = jest.fn<
    Promise<BranchLookupResult[]>,
    [unknown]
  >();
  const getStaffContextMock = jest.fn<Promise<StaffContext>, [JwtPayload]>();

  const prisma = {
    branch: {
      findMany: branchFindManyMock,
    },
  } as unknown as PrismaService;
  const branchAccessService = Object.assign(
    Object.create(BranchAccessService.prototype) as BranchAccessService,
    {
      getStaffContext: getStaffContextMock,
    },
  );

  const authUser: JwtPayload = {
    sub: 'auth-1',
    profileType: LoginProfileType.STAFF,
    profileId: 'staff-1',
    restaurantId: 'restaurant-1',
  };

  let service: ListBranchesService;

  const buildBranch = (
    overrides: Partial<BranchLookupResult> = {},
  ): BranchLookupResult => ({
    id: 'branch-1',
    restaurantId: 'restaurant-1',
    name: 'Providencia',
    address: 'Av. Providencia 1234',
    status: BranchStatus.ACTIVE,
    createdAt: new Date(),
    updatedAt: new Date(),
    settings: {
      branchId: 'branch-1',
      qrOrderingEnabled: true,
      qrPaymentMode: 'prepaid_order',
      splitBillEnabled: true,
      partialDeliveryEnabled: true,
      defaultMenuId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    ...overrides,
  });

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ListBranchesService(prisma, branchAccessService);
  });

  it('returns every restaurant branch when the caller is admin of at least one branch', async () => {
    getStaffContextMock.mockResolvedValue({
      staffUserId: 'staff-1',
      restaurantId: 'restaurant-1',
      memberBranchIds: new Set(['branch-1']),
      adminBranchIds: new Set(['branch-1']),
    });
    branchFindManyMock.mockResolvedValue([
      buildBranch(),
      buildBranch({
        id: 'branch-2',
        name: 'Las Condes',
        address: null,
        settings: null,
      }),
    ]);

    const result = await service.execute(authUser);

    expect(branchFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          restaurantId: 'restaurant-1',
        },
      }),
    );
    expect(result).toEqual([
      {
        branchId: 'branch-1',
        restaurantId: 'restaurant-1',
        name: 'Providencia',
        address: 'Av. Providencia 1234',
        status: BranchStatus.ACTIVE,
        settings: {
          qrOrderingEnabled: true,
          qrPaymentMode: 'prepaid_order',
          splitBillEnabled: true,
          partialDeliveryEnabled: true,
          autoDeliverAfterMinutes: null,
          tableAssignmentEnabled: false,
        },
      },
      {
        branchId: 'branch-2',
        restaurantId: 'restaurant-1',
        name: 'Las Condes',
        address: null,
        status: BranchStatus.ACTIVE,
        settings: {
          qrOrderingEnabled: true,
          qrPaymentMode: 'prepaid_order',
          splitBillEnabled: true,
          partialDeliveryEnabled: true,
          autoDeliverAfterMinutes: null,
          tableAssignmentEnabled: false,
        },
      },
    ]);
  });

  it('returns only branches with an active role when the caller is not admin', async () => {
    getStaffContextMock.mockResolvedValue({
      staffUserId: 'staff-1',
      restaurantId: 'restaurant-1',
      memberBranchIds: new Set(['branch-2']),
      adminBranchIds: new Set(),
    });
    branchFindManyMock.mockResolvedValue([
      buildBranch({ id: 'branch-2', name: 'Las Condes' }),
    ]);

    const result = await service.execute(authUser);

    expect(branchFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          restaurantId: 'restaurant-1',
          id: {
            in: ['branch-2'],
          },
        },
      }),
    );
    expect(result).toHaveLength(1);
    expect(result[0].branchId).toBe('branch-2');
  });

  it('returns an empty list when the caller has no active branch roles', async () => {
    getStaffContextMock.mockResolvedValue({
      staffUserId: 'staff-1',
      restaurantId: 'restaurant-1',
      memberBranchIds: new Set(),
      adminBranchIds: new Set(),
    });

    const result = await service.execute(authUser);

    expect(result).toEqual([]);
    expect(branchFindManyMock).not.toHaveBeenCalled();
  });
});

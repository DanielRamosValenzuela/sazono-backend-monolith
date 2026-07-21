import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { BranchStatus } from '@prisma/client';
import {
  BranchAccessService,
  type StaffContext,
} from '../../../common/branch-access/branch-access.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import { LoginProfileType } from '../../auth/dto/login.dto';
import type { JwtPayload } from '../../auth/interfaces/jwt-payload.interface';
import { UpdateBranchService } from './update-branch.service';

type BranchWithSettingsResult = {
  id: string;
  restaurantId: string;
  name: string;
  address: string | null;
  status: BranchStatus;
  settings: {
    qrOrderingEnabled: boolean;
    qrPaymentMode: string;
    splitBillEnabled: boolean;
    partialDeliveryEnabled: boolean;
  } | null;
};

type TransactionClient = {
  branch: {
    update: jest.Mock<Promise<{ id: string }>, [unknown]>;
    findUniqueOrThrow: jest.Mock<Promise<BranchWithSettingsResult>, [unknown]>;
  };
  branchSettings: {
    upsert: jest.Mock<Promise<{ branchId: string }>, [unknown]>;
  };
};

type TransactionCallback = (
  transactionClient: TransactionClient,
) => Promise<BranchWithSettingsResult>;

describe('UpdateBranchService', () => {
  const branchFindFirstMock = jest.fn<
    Promise<{ id: string } | null>,
    [unknown]
  >();
  const transactionMock = jest.fn<
    Promise<BranchWithSettingsResult>,
    [TransactionCallback]
  >();
  const getStaffContextMock = jest.fn<Promise<StaffContext>, [JwtPayload]>();

  const prisma = {
    branch: {
      findFirst: branchFindFirstMock,
    },
    $transaction: transactionMock,
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

  const adminContext: StaffContext = {
    staffUserId: 'staff-1',
    restaurantId: 'restaurant-1',
    memberBranchIds: new Set(['branch-1']),
    adminBranchIds: new Set(['branch-1']),
  };

  let service: UpdateBranchService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new UpdateBranchService(prisma, branchAccessService);
  });

  it('rejects an update without any field to change', async () => {
    getStaffContextMock.mockResolvedValue(adminContext);

    await expect(
      service.execute(authUser, 'branch-1', {}),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(branchFindFirstMock).not.toHaveBeenCalled();
  });

  it('throws 404 when the branch does not belong to the restaurant', async () => {
    getStaffContextMock.mockResolvedValue(adminContext);
    branchFindFirstMock.mockResolvedValue(null);

    await expect(
      service.execute(authUser, 'branch-other', { name: 'Nueva' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects a staff without ADMIN role on the target branch', async () => {
    getStaffContextMock.mockResolvedValue({
      ...adminContext,
      memberBranchIds: new Set(['branch-2']),
      adminBranchIds: new Set(['branch-2']),
    });
    branchFindFirstMock.mockResolvedValue({ id: 'branch-1' });

    await expect(
      service.execute(authUser, 'branch-1', { name: 'Nueva' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it('updates branch fields and merges settings partially', async () => {
    getStaffContextMock.mockResolvedValue(adminContext);
    branchFindFirstMock.mockResolvedValue({ id: 'branch-1' });

    const branchUpdateMock = jest
      .fn<Promise<{ id: string }>, [unknown]>()
      .mockResolvedValue({ id: 'branch-1' });
    const settingsUpsertMock = jest
      .fn<Promise<{ branchId: string }>, [unknown]>()
      .mockResolvedValue({ branchId: 'branch-1' });
    const branchFindUniqueOrThrowMock = jest
      .fn<Promise<BranchWithSettingsResult>, [unknown]>()
      .mockResolvedValue({
        id: 'branch-1',
        restaurantId: 'restaurant-1',
        name: 'Providencia Renovada',
        address: null,
        status: BranchStatus.INACTIVE,
        settings: {
          qrOrderingEnabled: false,
          qrPaymentMode: 'prepaid_order',
          splitBillEnabled: true,
          partialDeliveryEnabled: true,
        },
      });

    transactionMock.mockImplementation((callback) =>
      callback({
        branch: {
          update: branchUpdateMock,
          findUniqueOrThrow: branchFindUniqueOrThrowMock,
        },
        branchSettings: {
          upsert: settingsUpsertMock,
        },
      }),
    );

    const result = await service.execute(authUser, 'branch-1', {
      name: 'Providencia Renovada',
      address: null,
      status: BranchStatus.INACTIVE,
      settings: {
        qrOrderingEnabled: false,
      },
    });

    expect(branchUpdateMock).toHaveBeenCalledWith({
      where: {
        id: 'branch-1',
      },
      data: {
        name: 'Providencia Renovada',
        address: null,
        status: BranchStatus.INACTIVE,
      },
    });
    expect(settingsUpsertMock).toHaveBeenCalledWith({
      where: {
        branchId: 'branch-1',
      },
      update: {
        qrOrderingEnabled: false,
      },
      create: {
        branchId: 'branch-1',
        qrOrderingEnabled: false,
        qrPaymentMode: 'prepaid_order',
        splitBillEnabled: true,
        partialDeliveryEnabled: true,
        autoDeliverAfterMinutes: null,
        tableAssignmentEnabled: false,
      },
    });
    expect(result).toEqual({
      branchId: 'branch-1',
      restaurantId: 'restaurant-1',
      name: 'Providencia Renovada',
      address: null,
      status: BranchStatus.INACTIVE,
      settings: {
        qrOrderingEnabled: false,
        qrPaymentMode: 'prepaid_order',
        splitBillEnabled: true,
        partialDeliveryEnabled: true,
        autoDeliverAfterMinutes: null,
        tableAssignmentEnabled: false,
      },
    });
  });

  it('only upserts settings when no branch fields are sent', async () => {
    getStaffContextMock.mockResolvedValue(adminContext);
    branchFindFirstMock.mockResolvedValue({ id: 'branch-1' });

    const branchUpdateMock = jest
      .fn<Promise<{ id: string }>, [unknown]>()
      .mockResolvedValue({ id: 'branch-1' });
    const settingsUpsertMock = jest
      .fn<Promise<{ branchId: string }>, [unknown]>()
      .mockResolvedValue({ branchId: 'branch-1' });
    const branchFindUniqueOrThrowMock = jest
      .fn<Promise<BranchWithSettingsResult>, [unknown]>()
      .mockResolvedValue({
        id: 'branch-1',
        restaurantId: 'restaurant-1',
        name: 'Providencia',
        address: 'Av. Providencia 1234',
        status: BranchStatus.ACTIVE,
        settings: {
          qrOrderingEnabled: true,
          qrPaymentMode: 'postpaid_order',
          splitBillEnabled: true,
          partialDeliveryEnabled: true,
        },
      });

    transactionMock.mockImplementation((callback) =>
      callback({
        branch: {
          update: branchUpdateMock,
          findUniqueOrThrow: branchFindUniqueOrThrowMock,
        },
        branchSettings: {
          upsert: settingsUpsertMock,
        },
      }),
    );

    const result = await service.execute(authUser, 'branch-1', {
      settings: {
        qrPaymentMode: 'postpaid_order',
      },
    });

    expect(branchUpdateMock).not.toHaveBeenCalled();
    expect(settingsUpsertMock).toHaveBeenCalledWith({
      where: {
        branchId: 'branch-1',
      },
      update: {
        qrPaymentMode: 'postpaid_order',
      },
      create: {
        branchId: 'branch-1',
        qrOrderingEnabled: true,
        qrPaymentMode: 'postpaid_order',
        splitBillEnabled: true,
        partialDeliveryEnabled: true,
        autoDeliverAfterMinutes: null,
        tableAssignmentEnabled: false,
      },
    });
    expect(result.settings.qrPaymentMode).toBe('postpaid_order');
  });
});

import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { BranchStatus, Prisma } from '@prisma/client';
import {
  BranchAccessService,
  type StaffContext,
} from '../../../common/branch-access/branch-access.service';
import type { AuditService } from '../../../common/audit/audit.service';
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
    cashierRefundLimit?: Prisma.Decimal | null;
    refundTipDefault?: boolean;
  } | null;
};

type TransactionClient = {
  branch: {
    update: jest.Mock<Promise<{ id: string }>, [unknown]>;
    findUniqueOrThrow: jest.Mock<Promise<BranchWithSettingsResult>, [unknown]>;
  };
  branchSettings: {
    upsert: jest.Mock<Promise<unknown>, [unknown]>;
    findUnique?: jest.Mock<Promise<unknown>, [unknown]>;
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

  const auditRecordMock = jest.fn().mockResolvedValue(undefined);
  const auditService = { record: auditRecordMock } as unknown as AuditService;
  let service: UpdateBranchService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new UpdateBranchService(
      prisma,
      branchAccessService,
      auditService,
    );
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
        cashierRefundLimit: null,
        refundTipDefault: false,
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
        cashierRefundLimit: null,
        refundTipDefault: false,
        discountApprovalPercent: null,
        discountApprovalAmount: null,
        requireOpenCashSession: false,
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
        cashierRefundLimit: null,
        refundTipDefault: false,
      },
    });
    expect(result.settings.qrPaymentMode).toBe('postpaid_order');
  });

  it('stores the cashier refund limit and the tip default', async () => {
    getStaffContextMock.mockResolvedValue(adminContext);
    branchFindFirstMock.mockResolvedValue({ id: 'branch-1' });

    const settingsUpsertMock = jest
      .fn<Promise<unknown>, [unknown]>()
      .mockResolvedValue({
        cashierRefundLimit: new Prisma.Decimal(20000),
        refundTipDefault: true,
      });
    const found = {
      id: 'branch-1',
      restaurantId: 'restaurant-1',
      name: 'Providencia',
      address: null,
      status: BranchStatus.ACTIVE,
      settings: {
        qrOrderingEnabled: true,
        qrPaymentMode: 'prepaid_order',
        splitBillEnabled: true,
        partialDeliveryEnabled: true,
        cashierRefundLimit: new Prisma.Decimal(20000),
        refundTipDefault: true,
      },
    };

    transactionMock.mockImplementation((callback) =>
      callback({
        branch: {
          update: jest.fn(),
          findUniqueOrThrow: jest.fn().mockResolvedValue(found),
        },
        branchSettings: {
          upsert: settingsUpsertMock,
          findUnique: jest.fn().mockResolvedValue({
            cashierRefundLimit: null,
            refundTipDefault: false,
          }),
        },
      }),
    );

    const result = await service.execute(authUser, 'branch-1', {
      settings: { cashierRefundLimit: 20000, refundTipDefault: true },
    });

    expect(auditRecordMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        restaurantId: 'restaurant-1',
        branchId: 'branch-1',
        actorStaffUserId: 'staff-1',
        action: 'BRANCH_REFUND_SETTINGS_CHANGED',
        entityType: 'BranchSettings',
        entityId: 'branch-1',
        before: { cashierRefundLimit: null, refundTipDefault: false },
        after: { cashierRefundLimit: '20000', refundTipDefault: true },
      }),
    );

    expect(settingsUpsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        update: { cashierRefundLimit: 20000, refundTipDefault: true },
        create: expect.objectContaining({
          cashierRefundLimit: 20000,
          refundTipDefault: true,
        }),
      }),
    );
    expect(result.settings.cashierRefundLimit).toBe('20000');
    expect(result.settings.refundTipDefault).toBe(true);
  });

  it('clears the cashier refund limit with null', async () => {
    getStaffContextMock.mockResolvedValue(adminContext);
    branchFindFirstMock.mockResolvedValue({ id: 'branch-1' });
    const settingsUpsertMock = jest.fn().mockResolvedValue({
      cashierRefundLimit: null,
      refundTipDefault: false,
    });

    transactionMock.mockImplementation((callback) =>
      callback({
        branch: {
          update: jest.fn(),
          findUniqueOrThrow: jest.fn().mockResolvedValue({
            id: 'branch-1',
            restaurantId: 'restaurant-1',
            name: 'Providencia',
            address: null,
            status: BranchStatus.ACTIVE,
            settings: null,
          }),
        },
        branchSettings: {
          upsert: settingsUpsertMock,
          findUnique: jest.fn().mockResolvedValue({
            cashierRefundLimit: new Prisma.Decimal(5000),
            refundTipDefault: false,
          }),
        },
      }),
    );

    const result = await service.execute(authUser, 'branch-1', {
      settings: { cashierRefundLimit: null },
    });

    expect(auditRecordMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        before: { cashierRefundLimit: '5000', refundTipDefault: false },
        after: { cashierRefundLimit: null, refundTipDefault: false },
      }),
    );

    expect(settingsUpsertMock).toHaveBeenCalledWith(
      expect.objectContaining({ update: { cashierRefundLimit: null } }),
    );
    expect(result.settings.cashierRefundLimit).toBeNull();
  });

  it('stores requireOpenCashSession, audits it and returns it', async () => {
    getStaffContextMock.mockResolvedValue(adminContext);
    branchFindFirstMock.mockResolvedValue({ id: 'branch-1' });
    const settingsUpsertMock = jest
      .fn()
      .mockResolvedValue({ requireOpenCashSession: true });

    transactionMock.mockImplementation((callback) =>
      callback({
        branch: {
          update: jest.fn(),
          findUniqueOrThrow: jest.fn().mockResolvedValue({
            id: 'branch-1',
            restaurantId: 'restaurant-1',
            name: 'Providencia',
            address: null,
            status: BranchStatus.ACTIVE,
            settings: {
              qrOrderingEnabled: true,
              qrPaymentMode: 'prepaid_order',
              splitBillEnabled: true,
              partialDeliveryEnabled: true,
              requireOpenCashSession: true,
            },
          }),
        },
        branchSettings: {
          upsert: settingsUpsertMock,
          findUnique: jest
            .fn()
            .mockResolvedValue({ requireOpenCashSession: false }),
        },
      }),
    );

    const result = await service.execute(authUser, 'branch-1', {
      settings: { requireOpenCashSession: true },
    });

    expect(settingsUpsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        update: { requireOpenCashSession: true },
        create: expect.objectContaining({ requireOpenCashSession: true }),
      }),
    );
    expect(auditRecordMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: 'BRANCH_CASH_SETTINGS_CHANGED',
        before: { requireOpenCashSession: false },
        after: { requireOpenCashSession: true },
      }),
    );
    expect(result.settings.requireOpenCashSession).toBe(true);
  });

  it('does not audit when the refund settings keep their value', async () => {
    getStaffContextMock.mockResolvedValue(adminContext);
    branchFindFirstMock.mockResolvedValue({ id: 'branch-1' });

    transactionMock.mockImplementation((callback) =>
      callback({
        branch: {
          update: jest.fn(),
          findUniqueOrThrow: jest.fn().mockResolvedValue({
            id: 'branch-1',
            restaurantId: 'restaurant-1',
            name: 'Providencia',
            address: null,
            status: BranchStatus.ACTIVE,
            settings: null,
          }),
        },
        branchSettings: {
          upsert: jest.fn().mockResolvedValue({
            cashierRefundLimit: new Prisma.Decimal(5000),
            refundTipDefault: false,
          }),
          findUnique: jest.fn().mockResolvedValue({
            cashierRefundLimit: new Prisma.Decimal(5000),
            refundTipDefault: false,
          }),
        },
      }),
    );

    await service.execute(authUser, 'branch-1', {
      settings: { cashierRefundLimit: 5000 },
    });

    expect(auditRecordMock).not.toHaveBeenCalled();
  });
});

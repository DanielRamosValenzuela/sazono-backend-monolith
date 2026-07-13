import { BadRequestException, ConflictException } from '@nestjs/common';
import {
  BillSplitMode,
  BillSplitStatus,
  BillStatus,
  Prisma,
} from '@prisma/client';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import { LoginProfileType } from '../../auth/dto/login.dto';
import { CreateBillSplitService } from './create-bill-split.service';
import type { BranchAccessService } from '../../../common/branch-access/branch-access.service';

describe('CreateBillSplitService', () => {
  const billFindUniqueMock = jest.fn();
  const billSplitFindFirstMock = jest.fn();
  const billSplitCreateMock = jest.fn();
  const prisma = {
    bill: {
      findUnique: billFindUniqueMock,
    },
    billSplit: {
      findFirst: billSplitFindFirstMock,
      create: billSplitCreateMock,
    },
  } as unknown as PrismaService;

  const ensureAccessMock = jest.fn();
  const BranchAccessService = {
    ensureAccess: ensureAccessMock,
  } as unknown as BranchAccessService;

  const authUser = {
    sub: 'auth-1',
    profileType: LoginProfileType.STAFF,
    profileId: 'staff-1',
    restaurantId: 'restaurant-1',
  };

  let service: CreateBillSplitService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new CreateBillSplitService(prisma, BranchAccessService);
  });

  it('creates a BY_AMOUNT split when allocations match the remaining balance', async () => {
    billFindUniqueMock.mockResolvedValue({
      id: 'bill-1',
      branchId: 'branch-1',
      status: BillStatus.PARTIALLY_PAID,
      remainingAmount: new Prisma.Decimal(23600),
      branch: {
        settings: {
          splitBillEnabled: true,
        },
      },
    });
    ensureAccessMock.mockResolvedValue({
      staffUserId: 'staff-1',
      branchId: 'branch-1',
    });
    billSplitFindFirstMock.mockResolvedValue(null);
    billSplitCreateMock.mockResolvedValue({
      id: 'split-1',
      billId: 'bill-1',
      splitMode: BillSplitMode.BY_AMOUNT,
      status: BillSplitStatus.OPEN,
      participants: [
        {
          id: 'participant-1',
          participantToken: 'token-1',
          displayName: 'Ana',
          allocatedAmount: new Prisma.Decimal(11800),
          paidAmount: new Prisma.Decimal(0),
          status: 'PENDING',
        },
        {
          id: 'participant-2',
          participantToken: 'token-2',
          displayName: 'Luis',
          allocatedAmount: new Prisma.Decimal(11800),
          paidAmount: new Prisma.Decimal(0),
          status: 'PENDING',
        },
      ],
    });

    const result = await service.executeForStaff(authUser, 'bill-1', {
      participants: [
        { displayName: 'Ana', amount: '11800' },
        { displayName: 'Luis', amount: '11800' },
      ],
    });

    expect(result.splitMode).toBe(BillSplitMode.BY_AMOUNT);
    expect(result.participants).toHaveLength(2);
    expect(billSplitCreateMock).toHaveBeenCalled();
  });

  it('rejects splits when allocations do not match the remaining balance', async () => {
    billFindUniqueMock.mockResolvedValue({
      id: 'bill-1',
      branchId: 'branch-1',
      status: BillStatus.OPEN,
      remainingAmount: new Prisma.Decimal(23600),
      branch: {
        settings: {
          splitBillEnabled: true,
        },
      },
    });
    ensureAccessMock.mockResolvedValue({
      staffUserId: 'staff-1',
      branchId: 'branch-1',
    });
    billSplitFindFirstMock.mockResolvedValue(null);

    await expect(
      service.executeForStaff(authUser, 'bill-1', {
        participants: [{ amount: '10000' }, { amount: '10000' }],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects splits when the branch disabled split bill', async () => {
    billFindUniqueMock.mockResolvedValue({
      id: 'bill-1',
      branchId: 'branch-1',
      status: BillStatus.OPEN,
      remainingAmount: new Prisma.Decimal(10000),
      branch: {
        settings: {
          splitBillEnabled: false,
        },
      },
    });
    ensureAccessMock.mockResolvedValue({
      staffUserId: 'staff-1',
      branchId: 'branch-1',
    });

    await expect(
      service.executeForStaff(authUser, 'bill-1', {
        participants: [{ amount: '5000' }, { amount: '5000' }],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects creating a second active split on the same bill', async () => {
    billFindUniqueMock.mockResolvedValue({
      id: 'bill-1',
      branchId: 'branch-1',
      status: BillStatus.OPEN,
      remainingAmount: new Prisma.Decimal(10000),
      branch: {
        settings: {
          splitBillEnabled: true,
        },
      },
    });
    ensureAccessMock.mockResolvedValue({
      staffUserId: 'staff-1',
      branchId: 'branch-1',
    });
    billSplitFindFirstMock.mockResolvedValue({ id: 'existing-split' });

    await expect(
      service.executeForStaff(authUser, 'bill-1', {
        participants: [{ amount: '5000' }, { amount: '5000' }],
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

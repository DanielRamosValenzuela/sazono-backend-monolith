import { BadRequestException } from '@nestjs/common';
import { BillStatus, Prisma, Role, TableSessionStatus } from '@prisma/client';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { BillingBranchAccessService } from './billing-branch-access.service';
import { GetCurrentBillService } from './get-current-bill.service';
import { LoginProfileType } from '../../auth/dto/login.dto';

describe('GetCurrentBillService', () => {
  const findUniqueMock = jest.fn();
  const createBillMock = jest.fn<
    Promise<{
      id: string;
      tableSessionId: string;
      branchId: string;
      status: BillStatus;
      subtotalAmount: Prisma.Decimal;
      taxAmount: Prisma.Decimal;
      tipAmount: Prisma.Decimal;
      totalAmount: Prisma.Decimal;
      remainingAmount: Prisma.Decimal;
      openedAt: Date;
      closedAt: Date | null;
      closeReason: string | null;
    }>,
    [unknown]
  >();
  const prisma = {
    tableSession: {
      findUnique: findUniqueMock,
    },
    bill: {
      create: createBillMock,
    },
  } as unknown as PrismaService;

  const ensureAccessMock = jest.fn();
  const billingBranchAccessService = {
    ensureAccess: ensureAccessMock,
  } as unknown as BillingBranchAccessService;

  let service: GetCurrentBillService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new GetCurrentBillService(prisma, billingBranchAccessService);
  });

  it('returns the current bill for an active session', async () => {
    findUniqueMock.mockResolvedValue({
      id: 'session-1',
      branchId: 'branch-1',
      status: TableSessionStatus.OPEN,
      bill: {
        id: 'bill-1',
        tableSessionId: 'session-1',
        branchId: 'branch-1',
        status: BillStatus.OPEN,
        subtotalAmount: new Prisma.Decimal('10000'),
        taxAmount: new Prisma.Decimal('0'),
        tipAmount: new Prisma.Decimal('0'),
        totalAmount: new Prisma.Decimal('10000'),
        remainingAmount: new Prisma.Decimal('10000'),
        openedAt: new Date('2026-07-03T12:00:00.000Z'),
        closedAt: null,
        closeReason: null,
      },
    });
    ensureAccessMock.mockResolvedValue({
      staffUserId: 'staff-1',
      restaurantId: 'restaurant-1',
      branchId: 'branch-1',
      roles: [Role.CASHIER],
    });

    const result = await service.execute(
      {
        sub: 'auth-1',
        profileType: LoginProfileType.STAFF,
        profileId: 'staff-1',
        restaurantId: 'restaurant-1',
      },
      'session-1',
    );

    expect(createBillMock).not.toHaveBeenCalled();
    expect(result.billId).toBe('bill-1');
    expect(result.remainingAmount).toBe('10000');
  });

  it('creates a missing bill for a legacy active session', async () => {
    findUniqueMock.mockResolvedValue({
      id: 'session-legacy',
      branchId: 'branch-1',
      status: TableSessionStatus.OPEN,
      bill: null,
    });
    ensureAccessMock.mockResolvedValue({
      staffUserId: 'staff-1',
      restaurantId: 'restaurant-1',
      branchId: 'branch-1',
      roles: [Role.SUPERVISOR],
    });
    createBillMock.mockResolvedValue({
      id: 'bill-created',
      tableSessionId: 'session-legacy',
      branchId: 'branch-1',
      status: BillStatus.OPEN,
      subtotalAmount: new Prisma.Decimal('0'),
      taxAmount: new Prisma.Decimal('0'),
      tipAmount: new Prisma.Decimal('0'),
      totalAmount: new Prisma.Decimal('0'),
      remainingAmount: new Prisma.Decimal('0'),
      openedAt: new Date('2026-07-03T12:00:00.000Z'),
      closedAt: null,
      closeReason: null,
    });

    const result = await service.execute(
      {
        sub: 'auth-1',
        profileType: LoginProfileType.STAFF,
        profileId: 'staff-1',
        restaurantId: 'restaurant-1',
      },
      'session-legacy',
    );

    const createBillArgs = createBillMock.mock.calls[0]?.[0] as {
      data: {
        tableSessionId: string;
        branchId: string;
        status: BillStatus;
      };
    };

    expect(createBillArgs.data.tableSessionId).toBe('session-legacy');
    expect(createBillArgs.data.branchId).toBe('branch-1');
    expect(createBillArgs.data.status).toBe(BillStatus.OPEN);
    expect(result.billId).toBe('bill-created');
  });

  it('rejects a closed session without an operational bill', async () => {
    findUniqueMock.mockResolvedValue({
      id: 'session-closed',
      branchId: 'branch-1',
      status: TableSessionStatus.CLOSED,
      bill: null,
    });
    ensureAccessMock.mockResolvedValue({
      staffUserId: 'staff-1',
      restaurantId: 'restaurant-1',
      branchId: 'branch-1',
      roles: [Role.ADMIN],
    });

    await expect(
      service.execute(
        {
          sub: 'auth-1',
          profileType: LoginProfileType.STAFF,
          profileId: 'staff-1',
          restaurantId: 'restaurant-1',
        },
        'session-closed',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

import { OrderStatus, PaymentPolicy } from '@prisma/client';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import { LoginProfileType } from '../../auth/dto/login.dto';
import { CancelOrderService } from './cancel-order.service';
import type { OrdersBranchAccessService } from './orders-branch-access.service';

describe('CancelOrderService', () => {
  const orderFindUniqueMock = jest.fn();
  const orderFindUniqueOrThrowMock = jest.fn();
  const transactionMock = jest.fn();
  const prisma = {
    order: {
      findUnique: orderFindUniqueMock,
      findUniqueOrThrow: orderFindUniqueOrThrowMock,
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    orderItem: {
      updateMany: jest.fn(),
    },
    $transaction: transactionMock,
  } as unknown as PrismaService;

  const ensureAccessMock = jest.fn();
  const ordersBranchAccessService = {
    ensureAccess: ensureAccessMock,
  } as unknown as OrdersBranchAccessService;

  const authUser = {
    sub: 'auth-1',
    profileType: LoginProfileType.STAFF,
    profileId: 'staff-1',
    restaurantId: 'restaurant-1',
  };

  let service: CancelOrderService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new CancelOrderService(prisma, ordersBranchAccessService);
  });

  it('cancels an awaiting payment QR order without touching the bill', async () => {
    orderFindUniqueMock.mockResolvedValue({
      id: 'order-1',
      branchId: 'branch-1',
      status: OrderStatus.AWAITING_PAYMENT,
      paymentPolicy: PaymentPolicy.PREPAID,
      billId: 'bill-1',
      orderItems: [],
    });
    ensureAccessMock.mockResolvedValue({
      staffUserId: 'staff-1',
      branchId: 'branch-1',
      roles: ['WAITER'],
    });
    transactionMock.mockResolvedValue([]);
    orderFindUniqueOrThrowMock.mockResolvedValue({
      id: 'order-1',
      tableSessionId: 'session-1',
      billId: 'bill-1',
      branchId: 'branch-1',
      source: 'QR',
      paymentPolicy: PaymentPolicy.PREPAID,
      status: OrderStatus.CANCELLED,
      notes: null,
      submittedAt: null,
      createdAt: new Date('2026-07-07T12:00:00.000Z'),
      orderItems: [],
      stationTickets: [],
    });

    const result = await service.execute(authUser, 'order-1', {});

    expect(result.status).toBe(OrderStatus.CANCELLED);
    expect(transactionMock).toHaveBeenCalled();
  });
});

import { ConflictException } from '@nestjs/common';
import { OrderStatus } from '@prisma/client';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import { LoginProfileType } from '../../auth/dto/login.dto';
import { DeliverOrderService } from './deliver-order.service';
import type { BranchAccessService } from '../../../common/branch-access/branch-access.service';

describe('DeliverOrderService', () => {
  const orderFindUniqueMock = jest.fn();
  const orderFindUniqueOrThrowMock = jest.fn();
  const transactionMock = jest.fn();
  const prisma = {
    order: {
      findUnique: orderFindUniqueMock,
      findUniqueOrThrow: orderFindUniqueOrThrowMock,
      update: jest.fn(),
    },
    orderItem: {
      updateMany: jest.fn(),
    },
    $transaction: transactionMock,
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

  let service: DeliverOrderService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new DeliverOrderService(prisma, BranchAccessService);
  });

  it('marks a ready order as delivered', async () => {
    orderFindUniqueMock.mockResolvedValue({
      id: 'order-1',
      branchId: 'branch-1',
      status: OrderStatus.READY,
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
      source: 'WAITER',
      paymentPolicy: 'POSTPAID',
      status: OrderStatus.DELIVERED,
      notes: null,
      submittedAt: null,
      createdAt: new Date('2026-07-07T12:00:00.000Z'),
      orderItems: [],
      stationTickets: [],
    });

    const result = await service.execute(authUser, 'order-1');

    expect(result.status).toBe(OrderStatus.DELIVERED);
  });

  it('rejects delivery when the order is not ready', async () => {
    orderFindUniqueMock.mockResolvedValue({
      id: 'order-1',
      branchId: 'branch-1',
      status: OrderStatus.IN_PREPARATION,
    });
    ensureAccessMock.mockResolvedValue({
      staffUserId: 'staff-1',
      branchId: 'branch-1',
      roles: ['WAITER'],
    });

    await expect(service.execute(authUser, 'order-1')).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
});

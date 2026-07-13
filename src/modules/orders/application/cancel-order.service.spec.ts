import { ForbiddenException } from '@nestjs/common';
import {
  BillItemStatus,
  BillStatus,
  OrderStatus,
  PaymentPolicy,
  Prisma,
} from '@prisma/client';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import { LoginProfileType } from '../../auth/dto/login.dto';
import { CancelOrderService } from './cancel-order.service';
import type { BranchAccessService } from '../../../common/branch-access/branch-access.service';

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
  const BranchAccessService = {
    ensureAccess: ensureAccessMock,
  } as unknown as BranchAccessService;

  const authUser = {
    sub: 'auth-1',
    profileType: LoginProfileType.STAFF,
    profileId: 'staff-1',
    restaurantId: 'restaurant-1',
  };

  let service: CancelOrderService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new CancelOrderService(prisma, BranchAccessService);
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

  it('allows a WAITER to cancel a ROUTED order (queued, no ticket started yet)', async () => {
    orderFindUniqueMock.mockResolvedValue({
      id: 'order-2',
      branchId: 'branch-1',
      status: OrderStatus.ROUTED,
      paymentPolicy: PaymentPolicy.POSTPAID,
      billId: 'bill-1',
      orderItems: [{ id: 'order-item-1' }],
    });
    ensureAccessMock.mockResolvedValue({
      staffUserId: 'staff-1',
      branchId: 'branch-1',
      roles: ['WAITER'],
    });

    const billItemUpdateManyMock = jest.fn().mockResolvedValue({ count: 1 });
    const billFindUniqueOrThrowMock = jest.fn().mockResolvedValue({
      id: 'bill-1',
      tipAmount: new Prisma.Decimal(0),
      totalAmount: new Prisma.Decimal(5900),
      remainingAmount: new Prisma.Decimal(5900),
    });
    const billItemFindManyMock = jest.fn().mockResolvedValue([]);
    const billUpdateMock = jest.fn().mockResolvedValue({});
    const stationTicketUpdateManyMock = jest
      .fn()
      .mockResolvedValue({ count: 1 });
    const stationTicketItemUpdateManyMock = jest
      .fn()
      .mockResolvedValue({ count: 1 });
    const orderItemUpdateManyMock = jest.fn().mockResolvedValue({ count: 1 });
    const orderUpdateMock = jest.fn().mockResolvedValue({});

    transactionMock.mockImplementation(
      (callback: (tx: unknown) => Promise<unknown>) =>
        callback({
          billItem: {
            updateMany: billItemUpdateManyMock,
            findMany: billItemFindManyMock,
          },
          bill: {
            findUniqueOrThrow: billFindUniqueOrThrowMock,
            update: billUpdateMock,
          },
          stationTicket: { updateMany: stationTicketUpdateManyMock },
          stationTicketItem: { updateMany: stationTicketItemUpdateManyMock },
          orderItem: { updateMany: orderItemUpdateManyMock },
          order: { update: orderUpdateMock },
        }),
    );

    orderFindUniqueOrThrowMock.mockResolvedValue({
      id: 'order-2',
      tableSessionId: 'session-1',
      billId: 'bill-1',
      branchId: 'branch-1',
      source: 'WAITER',
      paymentPolicy: PaymentPolicy.POSTPAID,
      status: OrderStatus.CANCELLED,
      notes: null,
      submittedAt: new Date('2026-07-08T12:00:00.000Z'),
      createdAt: new Date('2026-07-08T12:00:00.000Z'),
      orderItems: [],
      stationTickets: [],
    });

    const result = await service.execute(authUser, 'order-2', {
      reason: 'cliente cambio de opinion',
    });

    expect(result.status).toBe(OrderStatus.CANCELLED);
    expect(billItemUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          billId: 'bill-1',
          status: BillItemStatus.OPEN,
        }),
        data: { status: BillItemStatus.VOID },
      }),
    );
    expect(stationTicketUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ orderId: 'order-2' }),
      }),
    );
    const billUpdateArgs = billUpdateMock.mock.calls[0][0] as {
      data: Record<string, unknown>;
    };
    expect(billUpdateArgs.data).toMatchObject({ status: BillStatus.OPEN });
    const orderUpdateArgs = orderUpdateMock.mock.calls[0][0] as {
      data: Record<string, unknown>;
    };
    expect(orderUpdateArgs.data).toMatchObject({
      status: OrderStatus.CANCELLED,
      notes: 'cliente cambio de opinion',
    });
  });

  it('still blocks a WAITER from cancelling an order that is IN_PREPARATION', async () => {
    orderFindUniqueMock.mockResolvedValue({
      id: 'order-3',
      branchId: 'branch-1',
      status: OrderStatus.IN_PREPARATION,
      paymentPolicy: PaymentPolicy.POSTPAID,
      billId: 'bill-1',
      orderItems: [{ id: 'order-item-1' }],
    });
    ensureAccessMock.mockResolvedValue({
      staffUserId: 'staff-1',
      branchId: 'branch-1',
      roles: ['WAITER'],
    });

    await expect(
      service.execute(authUser, 'order-3', {}),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it('allows an ADMIN to cancel an order that is IN_PREPARATION', async () => {
    orderFindUniqueMock.mockResolvedValue({
      id: 'order-4',
      branchId: 'branch-1',
      status: OrderStatus.IN_PREPARATION,
      paymentPolicy: PaymentPolicy.POSTPAID,
      billId: 'bill-1',
      orderItems: [{ id: 'order-item-1' }],
    });
    ensureAccessMock.mockResolvedValue({
      staffUserId: 'staff-1',
      branchId: 'branch-1',
      roles: ['ADMIN'],
    });

    transactionMock.mockImplementation(
      (callback: (tx: unknown) => Promise<unknown>) =>
        callback({
          billItem: {
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
            findMany: jest.fn().mockResolvedValue([]),
          },
          bill: {
            findUniqueOrThrow: jest.fn().mockResolvedValue({
              id: 'bill-1',
              tipAmount: new Prisma.Decimal(0),
              totalAmount: new Prisma.Decimal(5900),
              remainingAmount: new Prisma.Decimal(5900),
            }),
            update: jest.fn().mockResolvedValue({}),
          },
          stationTicket: {
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
          },
          stationTicketItem: {
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
          },
          orderItem: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
          order: { update: jest.fn().mockResolvedValue({}) },
        }),
    );

    orderFindUniqueOrThrowMock.mockResolvedValue({
      id: 'order-4',
      tableSessionId: 'session-1',
      billId: 'bill-1',
      branchId: 'branch-1',
      source: 'WAITER',
      paymentPolicy: PaymentPolicy.POSTPAID,
      status: OrderStatus.CANCELLED,
      notes: null,
      submittedAt: new Date('2026-07-08T12:00:00.000Z'),
      createdAt: new Date('2026-07-08T12:00:00.000Z'),
      orderItems: [],
      stationTickets: [],
    });

    const result = await service.execute(authUser, 'order-4', {});
    expect(result.status).toBe(OrderStatus.CANCELLED);
  });
});

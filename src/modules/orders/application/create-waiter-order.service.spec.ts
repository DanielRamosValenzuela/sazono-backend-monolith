import { BadRequestException } from '@nestjs/common';
import {
  BillStatus,
  OrderStatus,
  PaymentPolicy,
  Prisma,
  TableSessionStatus,
} from '@prisma/client';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import { LoginProfileType } from '../../auth/dto/login.dto';
import { CreateWaiterOrderService } from './create-waiter-order.service';
import type { OrderableMenuItemResolverService } from './orderable-menu-item-resolver.service';
import type { BranchAccessService } from '../../../common/branch-access/branch-access.service';

describe('CreateWaiterOrderService', () => {
  const tableSessionFindUniqueMock = jest.fn();
  const orderFindUniqueOrThrowMock = jest.fn();
  const transactionMock = jest.fn();
  const prisma = {
    tableSession: {
      findUnique: tableSessionFindUniqueMock,
    },
    order: {
      findUniqueOrThrow: orderFindUniqueOrThrowMock,
    },
    $transaction: transactionMock,
  } as unknown as PrismaService;

  const ensureAccessMock = jest.fn();
  const BranchAccessService = {
    ensureAccess: ensureAccessMock,
  } as unknown as BranchAccessService;

  const resolveMock = jest.fn();
  const orderableMenuItemResolverService = {
    resolve: resolveMock,
  } as unknown as OrderableMenuItemResolverService;

  const authUser = {
    sub: 'auth-1',
    profileType: LoginProfileType.STAFF,
    profileId: 'staff-1',
    restaurantId: 'restaurant-1',
  };

  let service: CreateWaiterOrderService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new CreateWaiterOrderService(
      prisma,
      BranchAccessService,
      orderableMenuItemResolverService,
    );
  });

  it('creates a postpaid routed order, charges the bill and creates station tickets', async () => {
    tableSessionFindUniqueMock.mockResolvedValue({
      id: 'session-1',
      branchId: 'branch-1',
      status: TableSessionStatus.OPEN,
      bill: {
        id: 'bill-1',
        tableSessionId: 'session-1',
        subtotalAmount: new Prisma.Decimal(0),
        tipAmount: new Prisma.Decimal(0),
        totalAmount: new Prisma.Decimal(0),
        remainingAmount: new Prisma.Decimal(0),
      },
    });
    ensureAccessMock.mockResolvedValue({
      staffUserId: 'staff-1',
      restaurantId: 'restaurant-1',
      branchId: 'branch-1',
      roles: ['WAITER'],
    });
    resolveMock.mockResolvedValue([
      {
        menuItemId: 'menu-item-1',
        name: 'Pisco Sour',
        price: new Prisma.Decimal(5900),
        preparationStationId: 'station-bar',
        quantity: 2,
        notes: null,
      },
      {
        menuItemId: 'menu-item-2',
        name: 'Lomo saltado',
        price: new Prisma.Decimal(11900),
        preparationStationId: 'station-kitchen',
        quantity: 1,
        notes: 'Sin cebolla.',
      },
    ]);

    const orderCreateMock = jest
      .fn<Promise<unknown>, [unknown]>()
      .mockResolvedValue({
        id: 'order-1',
        branchId: 'branch-1',
      });
    const orderItemCreateMock = jest
      .fn<Promise<unknown>, [unknown]>()
      .mockResolvedValueOnce({ id: 'order-item-1' })
      .mockResolvedValueOnce({ id: 'order-item-2' });
    const billItemCreateManyMock = jest
      .fn<Promise<unknown>, [unknown]>()
      .mockResolvedValue({ count: 2 });
    const billUpdateMock = jest
      .fn<Promise<unknown>, [unknown]>()
      .mockResolvedValue({});
    const stationTicketCreateMock = jest
      .fn<Promise<unknown>, [unknown]>()
      .mockResolvedValue({});
    const tableSessionUpdateManyMock = jest
      .fn<Promise<unknown>, [unknown]>()
      .mockResolvedValue({ count: 0 });

    transactionMock.mockImplementation(
      (callback: (tx: unknown) => Promise<unknown>) =>
        callback({
          order: { create: orderCreateMock },
          orderItem: { create: orderItemCreateMock },
          billItem: { createMany: billItemCreateManyMock },
          bill: { update: billUpdateMock },
          stationTicket: { create: stationTicketCreateMock },
          tableSession: { updateMany: tableSessionUpdateManyMock },
        }),
    );

    orderFindUniqueOrThrowMock.mockResolvedValue({
      id: 'order-1',
      tableSessionId: 'session-1',
      billId: 'bill-1',
      branchId: 'branch-1',
      source: 'WAITER',
      paymentPolicy: PaymentPolicy.POSTPAID,
      status: OrderStatus.ROUTED,
      notes: null,
      submittedAt: new Date('2026-07-07T12:00:00.000Z'),
      createdAt: new Date('2026-07-07T12:00:00.000Z'),
      orderItems: [],
      stationTickets: [],
    });

    const result = await service.execute(authUser, {
      tableSessionId: 'session-1',
      items: [
        { menuItemId: 'menu-item-1', quantity: 2 },
        { menuItemId: 'menu-item-2', quantity: 1, notes: 'Sin cebolla.' },
      ],
    });

    expect(result.status).toBe(OrderStatus.ROUTED);
    expect(result.paymentPolicy).toBe(PaymentPolicy.POSTPAID);

    const orderCreateArgs = orderCreateMock.mock.calls[0][0] as {
      data: Record<string, unknown>;
    };
    expect(orderCreateArgs.data).toMatchObject({
      status: OrderStatus.ROUTED,
      paymentPolicy: PaymentPolicy.POSTPAID,
      createdByStaffUserId: 'staff-1',
    });
    const billUpdateArgs = billUpdateMock.mock.calls[0][0] as {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    };
    expect(billUpdateArgs.where).toEqual({ id: 'bill-1' });
    expect(billUpdateArgs.data).toMatchObject({
      status: BillStatus.OPEN,
      subtotalAmount: new Prisma.Decimal(23700),
      totalAmount: new Prisma.Decimal(23700),
      remainingAmount: new Prisma.Decimal(23700),
    });
    expect(stationTicketCreateMock).toHaveBeenCalledTimes(2);
  });

  it('rejects orders over a session that is not active', async () => {
    tableSessionFindUniqueMock.mockResolvedValue({
      id: 'session-1',
      branchId: 'branch-1',
      status: TableSessionStatus.CLOSED,
      bill: null,
    });

    await expect(
      service.execute(authUser, {
        tableSessionId: 'session-1',
        items: [{ menuItemId: 'menu-item-1', quantity: 1 }],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(transactionMock).not.toHaveBeenCalled();
  });
});

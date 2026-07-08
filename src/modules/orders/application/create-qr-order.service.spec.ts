import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  OrderStatus,
  PaymentPolicy,
  Prisma,
  TableSessionOpenedBySource,
  TableStatus,
} from '@prisma/client';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import { CreateQrOrderService } from './create-qr-order.service';
import type { OrderableMenuItemResolverService } from './orderable-menu-item-resolver.service';

describe('CreateQrOrderService', () => {
  const tableFindUniqueMock = jest.fn();
  const orderFindUniqueOrThrowMock = jest.fn();
  const transactionMock = jest.fn();
  const prisma = {
    table: {
      findUnique: tableFindUniqueMock,
    },
    order: {
      findUniqueOrThrow: orderFindUniqueOrThrowMock,
    },
    $transaction: transactionMock,
  } as unknown as PrismaService;

  const resolveMock = jest.fn();
  const orderableMenuItemResolverService = {
    resolve: resolveMock,
  } as unknown as OrderableMenuItemResolverService;

  let service: CreateQrOrderService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new CreateQrOrderService(
      prisma,
      orderableMenuItemResolverService,
    );
  });

  it('opens a session when the table has none and leaves the order awaiting payment', async () => {
    tableFindUniqueMock.mockResolvedValue({
      id: 'table-1',
      branchId: 'branch-1',
      status: TableStatus.AVAILABLE,
      branch: {
        settings: {
          qrOrderingEnabled: true,
        },
      },
    });
    resolveMock.mockResolvedValue([
      {
        menuItemId: 'menu-item-1',
        name: 'Pisco Sour',
        price: new Prisma.Decimal(5900),
        preparationStationId: 'station-bar',
        quantity: 1,
        notes: null,
      },
    ]);

    const sessionFindFirstMock = jest
      .fn<Promise<unknown>, [unknown]>()
      .mockResolvedValue(null);
    const sessionCreateMock = jest
      .fn<Promise<unknown>, [unknown]>()
      .mockResolvedValue({ id: 'session-1' });
    const billCreateMock = jest
      .fn<Promise<unknown>, [unknown]>()
      .mockResolvedValue({ id: 'bill-1' });
    const tableUpdateMock = jest
      .fn<Promise<unknown>, [unknown]>()
      .mockResolvedValue({});
    const orderCreateMock = jest
      .fn<Promise<unknown>, [unknown]>()
      .mockResolvedValue({ id: 'order-1' });
    const orderItemCreateManyMock = jest
      .fn<Promise<unknown>, [unknown]>()
      .mockResolvedValue({ count: 1 });
    const billItemCreateManyMock = jest.fn<Promise<unknown>, [unknown]>();
    const stationTicketCreateMock = jest.fn<Promise<unknown>, [unknown]>();

    transactionMock.mockImplementation(
      (callback: (tx: unknown) => Promise<unknown>) =>
        callback({
          tableSession: {
            findFirst: sessionFindFirstMock,
            create: sessionCreateMock,
          },
          bill: { create: billCreateMock },
          table: { update: tableUpdateMock },
          order: { create: orderCreateMock },
          orderItem: { createMany: orderItemCreateManyMock },
          billItem: { createMany: billItemCreateManyMock },
          stationTicket: { create: stationTicketCreateMock },
        }),
    );

    orderFindUniqueOrThrowMock.mockResolvedValue({
      id: 'order-1',
      tableSessionId: 'session-1',
      billId: 'bill-1',
      branchId: 'branch-1',
      source: 'QR',
      paymentPolicy: PaymentPolicy.PREPAID,
      status: OrderStatus.AWAITING_PAYMENT,
      notes: null,
      submittedAt: new Date('2026-07-07T12:00:00.000Z'),
      createdAt: new Date('2026-07-07T12:00:00.000Z'),
      orderItems: [],
      stationTickets: [],
    });

    const result = await service.execute('qr-token-1', {
      items: [{ menuItemId: 'menu-item-1', quantity: 1 }],
    });

    expect(result.status).toBe(OrderStatus.AWAITING_PAYMENT);
    expect(result.paymentPolicy).toBe(PaymentPolicy.PREPAID);

    const sessionCreateArgs = sessionCreateMock.mock.calls[0][0] as {
      data: Record<string, unknown>;
    };
    expect(sessionCreateArgs.data).toMatchObject({
      openedBySource: TableSessionOpenedBySource.QR,
    });
    expect(billItemCreateManyMock).not.toHaveBeenCalled();
    expect(stationTicketCreateMock).not.toHaveBeenCalled();
  });

  it('rejects QR orders when the branch disabled QR ordering', async () => {
    tableFindUniqueMock.mockResolvedValue({
      id: 'table-1',
      branchId: 'branch-1',
      status: TableStatus.AVAILABLE,
      branch: {
        settings: {
          qrOrderingEnabled: false,
        },
      },
    });

    await expect(
      service.execute('qr-token-1', {
        items: [{ menuItemId: 'menu-item-1', quantity: 1 }],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects QR orders for unknown or disabled tables', async () => {
    tableFindUniqueMock.mockResolvedValue(null);

    await expect(
      service.execute('qr-token-x', {
        items: [{ menuItemId: 'menu-item-1', quantity: 1 }],
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

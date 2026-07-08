import { ConflictException, NotFoundException } from '@nestjs/common';
import {
  BillStatus,
  OrderStatus,
  PaymentAttemptStatus,
  PaymentStatus,
  Prisma,
  TableStatus,
} from '@prisma/client';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import { PayQrOrderService } from './pay-qr-order.service';
import type { PaymentProviderPort } from './ports/payment-provider.port';

describe('PayQrOrderService', () => {
  const tableFindUniqueMock = jest.fn();
  const orderFindUniqueMock = jest.fn();
  const attemptCreateMock = jest.fn();
  const attemptUpdateMock = jest.fn();
  const orderUpdateMock = jest.fn();
  const transactionMock = jest.fn();
  const prisma = {
    table: {
      findUnique: tableFindUniqueMock,
    },
    order: {
      findUnique: orderFindUniqueMock,
      update: orderUpdateMock,
    },
    paymentAttempt: {
      create: attemptCreateMock,
      update: attemptUpdateMock,
    },
    $transaction: transactionMock,
  } as unknown as PrismaService;

  const chargeMock = jest.fn();
  const paymentProvider: PaymentProviderPort = {
    providerName: 'MANUAL',
    charge: chargeMock,
  };

  let service: PayQrOrderService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new PayQrOrderService(prisma, paymentProvider);
  });

  const table = {
    id: 'table-1',
    status: TableStatus.OCCUPIED,
  };

  const awaitingOrder = {
    id: 'order-1',
    billId: 'bill-1',
    branchId: 'branch-1',
    status: OrderStatus.AWAITING_PAYMENT,
    tableSession: {
      tableId: 'table-1',
    },
    branch: {
      restaurant: {
        currency: 'CLP',
      },
    },
    orderItems: [
      {
        id: 'order-item-1',
        nameSnapshot: 'Pisco Sour',
        priceSnapshot: new Prisma.Decimal(5900),
        quantity: 2,
        preparationStationId: 'station-bar',
      },
    ],
  };

  it('approves the payment, charges the bill, routes the order and settles the payment', async () => {
    tableFindUniqueMock.mockResolvedValue(table);
    orderFindUniqueMock.mockResolvedValue(awaitingOrder);
    attemptCreateMock.mockResolvedValue({ id: 'attempt-1' });
    chargeMock.mockResolvedValue({
      approved: true,
      providerReference: 'manual-ref-1',
    });

    const txOrderFindUniqueOrThrowMock = jest.fn().mockResolvedValue({
      id: 'order-1',
      status: OrderStatus.AWAITING_PAYMENT,
    });
    const txAttemptUpdateMock = jest.fn().mockResolvedValue({});
    const txPaymentCreateMock = jest.fn().mockResolvedValue({
      id: 'payment-1',
      billId: 'bill-1',
      amount: new Prisma.Decimal(11800),
      currency: 'CLP',
      provider: 'MANUAL',
      providerReference: 'manual-ref-1',
      status: PaymentStatus.PAID,
      paidAt: new Date('2026-07-07T12:00:00.000Z'),
    });
    const txBillFindUniqueOrThrowMock = jest
      .fn()
      .mockResolvedValueOnce({
        id: 'bill-1',
        tableSessionId: 'session-1',
        status: BillStatus.OPEN,
        subtotalAmount: new Prisma.Decimal(0),
        tipAmount: new Prisma.Decimal(0),
        taxAmount: new Prisma.Decimal(0),
        totalAmount: new Prisma.Decimal(0),
        remainingAmount: new Prisma.Decimal(0),
      })
      .mockResolvedValueOnce({
        id: 'bill-1',
        tableSessionId: 'session-1',
        status: BillStatus.OPEN,
        subtotalAmount: new Prisma.Decimal(11800),
        tipAmount: new Prisma.Decimal(0),
        taxAmount: new Prisma.Decimal(0),
        totalAmount: new Prisma.Decimal(11800),
        remainingAmount: new Prisma.Decimal(11800),
      });
    const txBillItemCreateManyMock = jest.fn().mockResolvedValue({ count: 1 });
    const txBillUpdateMock = jest.fn().mockResolvedValue({});
    const txSessionUpdateManyMock = jest.fn().mockResolvedValue({ count: 1 });
    const txStationTicketCreateMock = jest.fn().mockResolvedValue({});
    const txOrderUpdateMock = jest.fn().mockResolvedValue({
      id: 'order-1',
      status: OrderStatus.ROUTED,
    });

    transactionMock.mockImplementation(
      (callback: (tx: unknown) => Promise<unknown>) =>
        callback({
          order: {
            findUniqueOrThrow: txOrderFindUniqueOrThrowMock,
            update: txOrderUpdateMock,
          },
          paymentAttempt: { update: txAttemptUpdateMock },
          payment: { create: txPaymentCreateMock },
          bill: {
            findUniqueOrThrow: txBillFindUniqueOrThrowMock,
            update: txBillUpdateMock,
          },
          billItem: { createMany: txBillItemCreateManyMock },
          tableSession: { updateMany: txSessionUpdateManyMock },
          stationTicket: { create: txStationTicketCreateMock },
        }),
    );

    const result = await service.execute('qr-token-1', 'order-1', {
      tipAmount: '0',
    });

    expect(result.status).toBe(PaymentStatus.PAID);
    expect(result.order?.status).toBe(OrderStatus.ROUTED);
    expect(result.bill.remainingAmount).toBe('0');
    expect(result.bill.status).toBe(BillStatus.PAID);
    expect(txBillItemCreateManyMock).toHaveBeenCalled();
    expect(txStationTicketCreateMock).toHaveBeenCalledTimes(1);
    expect(txSessionUpdateManyMock).toHaveBeenCalled();
  });

  it('marks the order as PAYMENT_FAILED when the provider rejects the charge', async () => {
    tableFindUniqueMock.mockResolvedValue(table);
    orderFindUniqueMock.mockResolvedValue(awaitingOrder);
    attemptCreateMock.mockResolvedValue({ id: 'attempt-1' });
    chargeMock.mockResolvedValue({
      approved: false,
      failureReason: 'Fondos insuficientes.',
    });
    transactionMock.mockResolvedValue([]);

    await expect(
      service.execute('qr-token-1', 'order-1', {}),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(attemptUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: PaymentAttemptStatus.FAILED,
          failureReason: 'Fondos insuficientes.',
        }) as unknown,
      }),
    );
    expect(orderUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { status: OrderStatus.PAYMENT_FAILED },
      }),
    );
  });

  it('rejects paying an order that does not belong to the QR table', async () => {
    tableFindUniqueMock.mockResolvedValue(table);
    orderFindUniqueMock.mockResolvedValue({
      ...awaitingOrder,
      tableSession: {
        tableId: 'another-table',
      },
    });

    await expect(
      service.execute('qr-token-1', 'order-1', {}),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects paying an order that is not awaiting payment', async () => {
    tableFindUniqueMock.mockResolvedValue(table);
    orderFindUniqueMock.mockResolvedValue({
      ...awaitingOrder,
      status: OrderStatus.ROUTED,
    });

    await expect(
      service.execute('qr-token-1', 'order-1', {}),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

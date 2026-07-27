import { NotFoundException } from '@nestjs/common';
import {
  OrderStatus,
  PaymentAttemptStatus,
  PaymentStatus,
  TableStatus,
} from '@prisma/client';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import { GetQrOrderPaymentStatusService } from './get-qr-order-payment-status.service';

describe('GetQrOrderPaymentStatusService', () => {
  const tableFindUniqueMock = jest.fn();
  const orderFindUniqueMock = jest.fn();
  const paymentAttemptFindFirstMock = jest.fn();

  const prisma = {
    table: { findUnique: tableFindUniqueMock },
    order: { findUnique: orderFindUniqueMock },
    paymentAttempt: { findFirst: paymentAttemptFindFirstMock },
  } as unknown as PrismaService;

  let service: GetQrOrderPaymentStatusService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new GetQrOrderPaymentStatusService(prisma);
  });

  const table = { id: 'table-1', status: TableStatus.AVAILABLE };
  const order = {
    id: 'order-1',
    status: OrderStatus.ROUTED,
    updatedAt: new Date('2026-07-27T12:00:00.000Z'),
    tableSession: { tableId: 'table-1' },
  };

  it('throws when the QR token does not resolve to a table', async () => {
    tableFindUniqueMock.mockResolvedValue(null);

    await expect(
      service.execute('missing-token', 'order-1'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('throws when the order does not belong to the table of the QR token', async () => {
    tableFindUniqueMock.mockResolvedValue(table);
    orderFindUniqueMock.mockResolvedValue({
      ...order,
      tableSession: { tableId: 'other-table' },
    });

    await expect(service.execute('token-1', 'order-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('returns a null payment status when the order has no payment attempts yet', async () => {
    tableFindUniqueMock.mockResolvedValue(table);
    orderFindUniqueMock.mockResolvedValue(order);
    paymentAttemptFindFirstMock.mockResolvedValue(null);

    const result = await service.execute('token-1', 'order-1');

    expect(result).toEqual({
      orderId: 'order-1',
      orderStatus: OrderStatus.ROUTED,
      attemptStatus: null,
      paymentStatus: null,
      providerReference: null,
      failureReason: null,
      updatedAt: '2026-07-27T12:00:00.000Z',
    });
  });

  it('reports the latest attempt and its linked payment status', async () => {
    tableFindUniqueMock.mockResolvedValue(table);
    orderFindUniqueMock.mockResolvedValue(order);
    paymentAttemptFindFirstMock.mockResolvedValue({
      id: 'attempt-1',
      status: PaymentAttemptStatus.SUCCEEDED,
      providerReference: '999999999',
      failureReason: null,
      updatedAt: new Date('2026-07-27T12:05:00.000Z'),
      payment: { status: PaymentStatus.PAID },
    });

    const result = await service.execute('token-1', 'order-1');

    expect(result).toEqual({
      orderId: 'order-1',
      orderStatus: OrderStatus.ROUTED,
      attemptStatus: PaymentAttemptStatus.SUCCEEDED,
      paymentStatus: PaymentStatus.PAID,
      providerReference: '999999999',
      failureReason: null,
      updatedAt: '2026-07-27T12:05:00.000Z',
    });
    expect(paymentAttemptFindFirstMock).toHaveBeenCalledWith({
      where: { orderId: 'order-1' },
      orderBy: { createdAt: 'desc' },
      include: { payment: true },
    });
  });
});

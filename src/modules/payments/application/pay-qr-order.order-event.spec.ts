import { ConflictException } from '@nestjs/common';
import type { EventEmitter2 } from '@nestjs/event-emitter';
import type { Prisma } from '@prisma/client';
import { OrderStatus, TableStatus } from '@prisma/client';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import { ORDER_CREATED_EVENT } from '../../orders/domain/order-events';
import type { ChargePaymentService } from './charge-payment.service';
import type { FinalizePaymentService } from './finalize-payment.service';
import { PayQrOrderService } from './pay-qr-order.service';
import type { OfflinePaymentRecorderPort } from './ports/offline-payment-recorder.port';

jest.mock('../../orders/application/apply-order-charge-to-bill', () => ({
  applyOrderChargeToBill: jest.fn().mockResolvedValue(undefined),
  computeOrderChargeDelta: jest
    .fn()
    .mockResolvedValue(
      new (jest.requireActual<{ Prisma: typeof Prisma }>(
        '@prisma/client',
      ).Prisma.Decimal)(100),
    ),
}));
jest.mock('../../orders/application/route-order-to-stations', () => ({
  routeOrderToStations: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('./apply-payment-to-bill', () => ({
  applyPaymentToBill: jest.fn().mockResolvedValue({}),
}));
jest.mock('./payment-result-mapper', () => ({
  mapPaymentResult: jest.fn().mockReturnValue({ ok: true }),
}));
jest.mock('./hold-pending-charge', () => ({
  assertNoPaymentInReview: jest.fn().mockResolvedValue(undefined),
  holdPendingCharge: jest.fn(),
}));

describe('PayQrOrderService order created event', () => {
  const order = {
    id: 'order-1',
    billId: 'bill-1',
    branchId: 'branch-1',
    status: OrderStatus.AWAITING_PAYMENT,
    tableSession: { tableId: 'table-1' },
    branch: { restaurantId: 'r-1', restaurant: { currency: 'CLP' } },
    orderItems: [],
  };
  const txMock = {
    order: {
      updateMany: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
      findUniqueOrThrow: jest
        .fn()
        .mockResolvedValue({ id: 'order-1', status: OrderStatus.ROUTED }),
    },
    bill: { findUniqueOrThrow: jest.fn().mockResolvedValue({}) },
  };
  const transactionMock = jest.fn();
  const orderFindUniqueMock = jest.fn();
  const prisma = {
    table: {
      findUnique: jest
        .fn()
        .mockResolvedValue({ id: 'table-1', status: TableStatus.OCCUPIED }),
    },
    order: { findUnique: orderFindUniqueMock },
    paymentAttempt: {
      create: jest.fn().mockResolvedValue({ id: 'attempt-1' }),
    },
    $transaction: transactionMock,
  } as unknown as PrismaService;
  const emitMock = jest.fn();
  const chargeMock = jest.fn();
  const finalizeMock = jest.fn();
  const failMock = jest.fn();
  let service: PayQrOrderService;

  beforeEach(() => {
    jest.clearAllMocks();
    orderFindUniqueMock.mockResolvedValue(order);
    chargeMock.mockResolvedValue({
      kind: 'SETTLED',
      approved: true,
      providerName: 'MANUAL',
      providerReference: 'ref',
    });
    finalizeMock.mockResolvedValue({ id: 'payment-1' });
    txMock.order.updateMany.mockResolvedValue({ count: 1 });
    transactionMock.mockImplementation(
      (cb: (tx: unknown) => Promise<unknown>) => cb(txMock),
    );
    service = new PayQrOrderService(
      prisma,
      { providerName: 'MANUAL' } as OfflinePaymentRecorderPort,
      { execute: chargeMock } as unknown as ChargePaymentService,
      { execute: finalizeMock } as unknown as FinalizePaymentService,
      { execute: failMock },
      { emit: emitMock } as unknown as EventEmitter2,
    );
  });

  it('emits once, after the transaction commits', async () => {
    const events: string[] = [];
    transactionMock.mockImplementation(
      async (cb: (tx: unknown) => Promise<unknown>) => {
        const result = await cb(txMock);
        events.push('commit');
        return result;
      },
    );
    emitMock.mockImplementation(() => {
      events.push('emit');
    });

    await service.execute('qr', 'order-1', {});

    expect(events).toEqual(['commit', 'emit']);
    expect(emitMock).toHaveBeenCalledTimes(1);
    expect(emitMock).toHaveBeenCalledWith(ORDER_CREATED_EVENT, {
      orderId: 'order-1',
      branchId: 'branch-1',
    });
  });

  it('does not emit when the order was already routed (claim lost)', async () => {
    txMock.order.updateMany.mockResolvedValue({ count: 0 });

    await expect(service.execute('qr', 'order-1', {})).rejects.toBeInstanceOf(
      ConflictException,
    );

    expect(emitMock).not.toHaveBeenCalled();
  });

  it('does not emit when the transaction throws', async () => {
    finalizeMock.mockRejectedValue(new Error('boom'));

    await expect(service.execute('qr', 'order-1', {})).rejects.toThrow('boom');

    expect(emitMock).not.toHaveBeenCalled();
  });

  it('does not emit when the provider rejects the payment', async () => {
    chargeMock.mockResolvedValue({
      kind: 'SETTLED',
      approved: false,
      providerName: 'MANUAL',
    });

    await expect(service.execute('qr', 'order-1', {})).rejects.toBeInstanceOf(
      ConflictException,
    );

    expect(emitMock).not.toHaveBeenCalled();
  });

  it('does not break the payment when the emitter throws', async () => {
    emitMock.mockImplementation(() => {
      throw new Error('listener down');
    });

    await expect(service.execute('qr', 'order-1', {})).resolves.toEqual({
      ok: true,
    });
  });
});

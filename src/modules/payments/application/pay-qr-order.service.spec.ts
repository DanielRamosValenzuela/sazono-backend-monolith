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
import { ChargePaymentService } from './charge-payment.service';
import { FailPaymentService } from './fail-payment.service';
import { FinalizePaymentService } from './finalize-payment.service';
import { PayQrOrderService } from './pay-qr-order.service';
import type { MercadoPagoConfigService } from '../infrastructure/mercado-pago/mercado-pago-config.service';
import type { OfflinePaymentRecorderPort } from './ports/offline-payment-recorder.port';
import type { PaymentGatewayResolverPort } from './ports/payment-gateway-resolver.port';

describe('PayQrOrderService', () => {
  const tableFindUniqueMock = jest.fn();
  const orderFindUniqueMock = jest.fn();
  const attemptCreateMock = jest.fn();
  const transactionMock = jest.fn();
  const prisma = {
    table: {
      findUnique: tableFindUniqueMock,
    },
    order: {
      findUnique: orderFindUniqueMock,
    },
    paymentAttempt: {
      create: attemptCreateMock,
    },
    $transaction: transactionMock,
  } as unknown as PrismaService;

  const recordMock = jest.fn();
  const offlinePaymentRecorder: OfflinePaymentRecorderPort = {
    providerName: 'MANUAL',
    record: recordMock,
  };
  const resolveAvailableMock = jest.fn().mockResolvedValue([]);
  const paymentGatewayResolver: PaymentGatewayResolverPort = {
    resolveAvailable: resolveAvailableMock,
  };
  const mercadoPagoConfig = {
    qrGatewayRequired: false,
  } as unknown as MercadoPagoConfigService;
  const chargePaymentService = new ChargePaymentService(
    offlinePaymentRecorder,
    paymentGatewayResolver,
    mercadoPagoConfig,
  );
  const finalizePaymentService = new FinalizePaymentService();
  const failPaymentService = new FailPaymentService();

  let service: PayQrOrderService;

  beforeEach(() => {
    jest.clearAllMocks();
    resolveAvailableMock.mockResolvedValue([]);
    service = new PayQrOrderService(
      prisma,
      offlinePaymentRecorder,
      chargePaymentService,
      finalizePaymentService,
      failPaymentService,
    );
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
      restaurantId: 'restaurant-1',
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
    recordMock.mockResolvedValue({ providerReference: 'manual-ref-1' });

    const txOrderFindUniqueOrThrowMock = jest.fn().mockResolvedValue({
      id: 'order-1',
      status: OrderStatus.AWAITING_PAYMENT,
    });
    const txAttemptUpdateManyMock = jest.fn().mockResolvedValue({ count: 1 });
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
          paymentAttempt: { updateMany: txAttemptUpdateManyMock },
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
    expect(resolveAvailableMock).toHaveBeenCalledWith('restaurant-1');
  });

  it('marks the order as PAYMENT_FAILED when the provider rejects the charge', async () => {
    tableFindUniqueMock.mockResolvedValue(table);
    orderFindUniqueMock.mockResolvedValue(awaitingOrder);
    attemptCreateMock.mockResolvedValue({ id: 'attempt-1' });

    const chargeExecuteMock = jest.fn().mockResolvedValue({
      kind: 'SETTLED',
      approved: false,
      providerName: 'MANUAL',
      failureReason: 'Fondos insuficientes.',
    });
    const rejectingChargePaymentService = {
      execute: chargeExecuteMock,
    } as unknown as ChargePaymentService;
    const rejectingService = new PayQrOrderService(
      prisma,
      offlinePaymentRecorder,
      rejectingChargePaymentService,
      finalizePaymentService,
      failPaymentService,
    );

    const txAttemptUpdateManyMock = jest.fn().mockResolvedValue({ count: 1 });
    const txOrderUpdateMock = jest.fn().mockResolvedValue({});

    transactionMock.mockImplementation(
      (callback: (tx: unknown) => Promise<unknown>) =>
        callback({
          paymentAttempt: { updateMany: txAttemptUpdateManyMock },
          order: { update: txOrderUpdateMock },
        }),
    );

    await expect(
      rejectingService.execute('qr-token-1', 'order-1', {}),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(txAttemptUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'attempt-1', status: PaymentAttemptStatus.PENDING },
        data: expect.objectContaining({
          status: PaymentAttemptStatus.FAILED,
          failureReason: 'Fondos insuficientes.',
        }),
      }),
    );
    expect(txOrderUpdateMock).toHaveBeenCalledWith(
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

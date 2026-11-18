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

jest.mock('../../billing/application/lock-bill', () => ({
  lockBill: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../billing/application/refresh-bill-discounts', () => ({
  refreshBillDiscounts: jest
    .fn()
    .mockImplementation(() =>
      Promise.resolve(
        new (jest.requireActual<{ Prisma: typeof Prisma }>(
          '@prisma/client',
        ).Prisma.Decimal)(0),
      ),
    ),
}));

describe('PayQrOrderService', () => {
  const tableFindUniqueMock = jest.fn();
  const orderFindUniqueMock = jest.fn();
  const attemptCreateMock = jest.fn();
  const attemptUpdateMock = jest.fn();
  const attemptFindFirstMock = jest.fn().mockResolvedValue(null);
  const transactionMock = jest.fn();
  const billDiscountFindManyMock = jest.fn();
  const billFindUniqueOrThrowMock = jest.fn();
  const billItemFindManyMock = jest.fn();
  const prisma = {
    table: {
      findUnique: tableFindUniqueMock,
    },
    order: {
      findUnique: orderFindUniqueMock,
    },
    paymentAttempt: {
      create: attemptCreateMock,
      updateMany: attemptUpdateMock,
      findFirst: attemptFindFirstMock,
    },
    billDiscount: { findMany: billDiscountFindManyMock },
    bill: { findUniqueOrThrow: billFindUniqueOrThrowMock },
    billItem: { findMany: billItemFindManyMock },
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
    attemptFindFirstMock.mockResolvedValue(null);
    billDiscountFindManyMock.mockResolvedValue([]);
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

  it('leaves the attempt PENDING and the order untouched when the gateway reports a pending charge', async () => {
    tableFindUniqueMock.mockResolvedValue(table);
    orderFindUniqueMock.mockResolvedValue(awaitingOrder);
    attemptCreateMock.mockResolvedValue({ id: 'attempt-1' });
    attemptUpdateMock.mockResolvedValue({});

    const chargeExecuteMock = jest.fn().mockResolvedValue({
      kind: 'PENDING',
      providerName: 'MERCADO_PAGO',
      providerReference: 'ORD01',
    });
    const pendingService = new PayQrOrderService(
      prisma,
      offlinePaymentRecorder,
      { execute: chargeExecuteMock } as unknown as ChargePaymentService,
      finalizePaymentService,
      failPaymentService,
    );

    await expect(
      pendingService.execute('qr-token', 'order-1', {
        tipAmount: '1000',
        cardToken: 't',
        paymentMethodId: 'visa',
        installments: 1,
      }),
    ).rejects.toThrow(/en revision/);

    expect(attemptCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({ tipAmount: new Prisma.Decimal(1000) }),
    });
    expect(attemptUpdateMock).toHaveBeenCalledWith({
      where: { id: 'attempt-1', status: PaymentAttemptStatus.PENDING },
      data: { provider: 'MERCADO_PAGO', providerReference: 'ORD01' },
    });
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it('charges only the discounted delta when the bill has an active percent discount', async () => {
    tableFindUniqueMock.mockResolvedValue(table);
    orderFindUniqueMock.mockResolvedValue(awaitingOrder);
    attemptCreateMock.mockResolvedValue({ id: 'attempt-1' });
    billDiscountFindManyMock.mockResolvedValue([
      {
        id: 'discount-1',
        billItemId: null,
        type: 'PERCENT',
        value: new Prisma.Decimal(10),
      },
    ]);
    billFindUniqueOrThrowMock.mockResolvedValue({
      subtotalAmount: new Prisma.Decimal(10000),
      tipAmount: new Prisma.Decimal(0),
      totalAmount: new Prisma.Decimal(9000),
    });
    billItemFindManyMock.mockResolvedValue([
      { id: 'bill-item-1', totalPrice: new Prisma.Decimal(10000) },
    ]);

    const pendingService = new PayQrOrderService(
      prisma,
      offlinePaymentRecorder,
      {
        execute: jest.fn().mockResolvedValue({
          kind: 'PENDING',
          providerName: 'MERCADO_PAGO',
          providerReference: 'ORD01',
        }),
      } as unknown as ChargePaymentService,
      finalizePaymentService,
      failPaymentService,
    );

    await expect(
      pendingService.execute('qr-token', 'order-1', { tipAmount: '500' }),
    ).rejects.toThrow(/en revision/);

    expect(attemptCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({ amount: new Prisma.Decimal(11120) }),
    });
  });

  it('refuses a new charge while a Mercado Pago attempt for the order is still in review', async () => {
    tableFindUniqueMock.mockResolvedValue(table);
    orderFindUniqueMock.mockResolvedValue(awaitingOrder);
    attemptFindFirstMock.mockResolvedValue({ id: 'attempt-0' });

    await expect(service.execute('qr-token', 'order-1', {})).rejects.toThrow(
      /en revision/,
    );

    expect(attemptCreateMock).not.toHaveBeenCalled();
  });

  it('approves the payment, charges the bill, routes the order and settles the payment', async () => {
    tableFindUniqueMock.mockResolvedValue(table);
    orderFindUniqueMock.mockResolvedValue(awaitingOrder);
    attemptCreateMock.mockResolvedValue({ id: 'attempt-1' });
    recordMock.mockResolvedValue({ providerReference: 'manual-ref-1' });

    const txOrderFindUniqueOrThrowMock = jest.fn().mockResolvedValue({
      id: 'order-1',
      status: OrderStatus.ROUTED,
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
        discountAmount: new Prisma.Decimal(0),
        tipAmount: new Prisma.Decimal(0),
        taxAmount: new Prisma.Decimal(0),
        totalAmount: new Prisma.Decimal(0),
        remainingAmount: new Prisma.Decimal(0),
      })
      .mockResolvedValueOnce({
        id: 'bill-1',
        tableSessionId: 'session-1',
        status: BillStatus.OPEN,
        subtotalAmount: new Prisma.Decimal(0),
        discountAmount: new Prisma.Decimal(0),
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
        discountAmount: new Prisma.Decimal(0),
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
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
          },
          paymentAttempt: { updateMany: txAttemptUpdateManyMock },
          payment: { create: txPaymentCreateMock },
          bill: {
            findUniqueOrThrow: txBillFindUniqueOrThrowMock,
            update: txBillUpdateMock,
          },
          billItem: { createMany: txBillItemCreateManyMock },
          tableSession: { updateMany: txSessionUpdateManyMock },
          orderItem: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
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

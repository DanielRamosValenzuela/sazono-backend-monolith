import { BadRequestException, ConflictException } from '@nestjs/common';
import {
  BillStatus,
  PaymentAttemptStatus,
  PaymentStatus,
  Prisma,
  TableSessionStatus,
} from '@prisma/client';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import { ChargePaymentService } from './charge-payment.service';
import { FailPaymentService } from './fail-payment.service';
import { FinalizePaymentService } from './finalize-payment.service';
import { PaymentChannel } from '../domain/payment-channel';
import { SettleBillPaymentService } from './settle-bill-payment.service';
import type { MercadoPagoConfigService } from '../infrastructure/mercado-pago/mercado-pago-config.service';
import type { OfflinePaymentRecorderPort } from './ports/offline-payment-recorder.port';
import type { PaymentGatewayResolverPort } from './ports/payment-gateway-resolver.port';

describe('SettleBillPaymentService', () => {
  const attemptCreateMock = jest.fn();
  const attemptUpdateManyMock = jest.fn();
  const transactionMock = jest.fn();
  const prisma = {
    paymentAttempt: {
      create: attemptCreateMock,
      updateMany: attemptUpdateManyMock,
    },
    $transaction: transactionMock,
  } as unknown as PrismaService;

  const recordMock = jest.fn();
  const offlinePaymentRecorder: OfflinePaymentRecorderPort = {
    providerName: 'MANUAL',
    record: recordMock,
  };
  const resolveMock = jest.fn().mockResolvedValue(null);
  const paymentGatewayResolver: PaymentGatewayResolverPort = {
    resolve: resolveMock,
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

  let service: SettleBillPaymentService;

  beforeEach(() => {
    jest.clearAllMocks();
    resolveMock.mockResolvedValue(null);
    service = new SettleBillPaymentService(
      prisma,
      offlinePaymentRecorder,
      chargePaymentService,
      finalizePaymentService,
      failPaymentService,
    );
  });

  const openBill = {
    id: 'bill-1',
    status: BillStatus.OPEN,
    remainingAmount: new Prisma.Decimal(23600),
    currency: 'CLP',
    restaurantId: 'restaurant-1',
  };

  it('settles a partial payment with tip and leaves the bill partially paid', async () => {
    attemptCreateMock.mockResolvedValue({ id: 'attempt-1' });
    recordMock.mockResolvedValue({ providerReference: 'manual-ref-1' });

    const txAttemptUpdateManyMock = jest.fn().mockResolvedValue({ count: 1 });
    const txPaymentCreateMock = jest.fn().mockResolvedValue({
      id: 'payment-1',
      billId: 'bill-1',
      amount: new Prisma.Decimal(11000),
      currency: 'CLP',
      provider: 'MANUAL',
      providerReference: 'manual-ref-1',
      status: PaymentStatus.PAID,
      paidAt: new Date('2026-07-07T12:00:00.000Z'),
    });
    const txBillFindUniqueOrThrowMock = jest.fn().mockResolvedValue({
      id: 'bill-1',
      tableSessionId: 'session-1',
      status: BillStatus.OPEN,
      subtotalAmount: new Prisma.Decimal(23600),
      tipAmount: new Prisma.Decimal(0),
      taxAmount: new Prisma.Decimal(0),
      totalAmount: new Prisma.Decimal(23600),
      remainingAmount: new Prisma.Decimal(23600),
    });
    const txBillUpdateMock = jest.fn().mockResolvedValue({});
    const txSessionUpdateManyMock = jest.fn().mockResolvedValue({ count: 0 });

    transactionMock.mockImplementation(
      (callback: (tx: unknown) => Promise<unknown>) =>
        callback({
          paymentAttempt: { updateMany: txAttemptUpdateManyMock },
          payment: { create: txPaymentCreateMock },
          bill: {
            findUniqueOrThrow: txBillFindUniqueOrThrowMock,
            update: txBillUpdateMock,
          },
          tableSession: { updateMany: txSessionUpdateManyMock },
        }),
    );
    const result = await service.execute(
      PaymentChannel.STAFF_OFFLINE,
      openBill,
      new Prisma.Decimal(10000),
      new Prisma.Decimal(1000),
    );

    expect(result.status).toBe(PaymentStatus.PAID);
    expect(result.bill.status).toBe(BillStatus.PARTIALLY_PAID);
    expect(result.bill.totalAmount).toBe('24600');
    expect(result.bill.remainingAmount).toBe('13600');
    expect(txSessionUpdateManyMock).not.toHaveBeenCalled();
    expect(resolveMock).not.toHaveBeenCalled();
  });

  it('marks the session PAYMENT_COMPLETED when the payment settles the full balance', async () => {
    attemptCreateMock.mockResolvedValue({ id: 'attempt-1' });
    recordMock.mockResolvedValue({ providerReference: 'manual-ref-2' });

    const txPaymentCreateMock = jest.fn().mockResolvedValue({
      id: 'payment-1',
      billId: 'bill-1',
      amount: new Prisma.Decimal(23600),
      currency: 'CLP',
      provider: 'MANUAL',
      providerReference: 'manual-ref-2',
      status: PaymentStatus.PAID,
      paidAt: new Date('2026-07-07T12:00:00.000Z'),
    });
    const txBillFindUniqueOrThrowMock = jest.fn().mockResolvedValue({
      id: 'bill-1',
      tableSessionId: 'session-1',
      status: BillStatus.OPEN,
      subtotalAmount: new Prisma.Decimal(23600),
      tipAmount: new Prisma.Decimal(0),
      taxAmount: new Prisma.Decimal(0),
      totalAmount: new Prisma.Decimal(23600),
      remainingAmount: new Prisma.Decimal(23600),
    });
    const txBillUpdateMock = jest.fn().mockResolvedValue({});
    const txSessionUpdateManyMock = jest
      .fn<Promise<unknown>, [unknown]>()
      .mockResolvedValue({ count: 1 });

    transactionMock.mockImplementation(
      (callback: (tx: unknown) => Promise<unknown>) =>
        callback({
          paymentAttempt: {
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
          },
          payment: { create: txPaymentCreateMock },
          bill: {
            findUniqueOrThrow: txBillFindUniqueOrThrowMock,
            update: txBillUpdateMock,
          },
          tableSession: { updateMany: txSessionUpdateManyMock },
        }),
    );

    const result = await service.execute(
      PaymentChannel.QR_ONLINE,
      openBill,
      new Prisma.Decimal(23600),
      new Prisma.Decimal(0),
    );

    expect(result.bill.status).toBe(BillStatus.PAID);
    expect(result.bill.remainingAmount).toBe('0');
    expect(resolveMock).toHaveBeenCalledWith('restaurant-1');

    const sessionUpdateArgs = txSessionUpdateManyMock.mock.calls[0][0] as {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    };
    expect(sessionUpdateArgs.where).toMatchObject({ id: 'session-1' });
    expect(sessionUpdateArgs.data).toEqual({
      status: TableSessionStatus.PAYMENT_COMPLETED,
    });
  });

  it('rejects payments above the remaining balance', async () => {
    await expect(
      service.execute(
        PaymentChannel.STAFF_OFFLINE,
        openBill,
        new Prisma.Decimal(30000),
        new Prisma.Decimal(0),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(attemptCreateMock).not.toHaveBeenCalled();
  });

  it('rejects payments over a bill that is not payable', async () => {
    await expect(
      service.execute(
        PaymentChannel.STAFF_OFFLINE,
        { ...openBill, status: BillStatus.PAID },
        new Prisma.Decimal(1000),
        new Prisma.Decimal(0),
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('records the failed attempt and rejects when the charge is not approved', async () => {
    attemptCreateMock.mockResolvedValue({ id: 'attempt-1' });
    attemptUpdateManyMock.mockResolvedValue({ count: 1 });

    const chargeExecuteMock = jest.fn().mockResolvedValue({
      approved: false,
      providerName: 'MANUAL',
      failureReason: 'Fondos insuficientes.',
    });
    const rejectingChargePaymentService = {
      execute: chargeExecuteMock,
    } as unknown as ChargePaymentService;

    const rejectingService = new SettleBillPaymentService(
      prisma,
      offlinePaymentRecorder,
      rejectingChargePaymentService,
      finalizePaymentService,
      failPaymentService,
    );

    await expect(
      rejectingService.execute(
        PaymentChannel.STAFF_OFFLINE,
        openBill,
        new Prisma.Decimal(10000),
        new Prisma.Decimal(0),
      ),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(attemptUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'attempt-1', status: PaymentAttemptStatus.PENDING },
        data: expect.objectContaining({
          status: PaymentAttemptStatus.FAILED,
          failureReason: 'Fondos insuficientes.',
        }),
      }),
    );
  });

  it('forwards the checkout payload to the charge service for QR_ONLINE without ever building one for STAFF_OFFLINE', async () => {
    attemptCreateMock.mockResolvedValue({ id: 'attempt-1' });
    attemptUpdateManyMock.mockResolvedValue({ count: 1 });

    const chargeExecuteMock = jest.fn().mockResolvedValue({
      approved: false,
      providerName: 'MERCADO_PAGO',
      failureReason: 'La tarjeta no tiene saldo suficiente.',
    });
    const spyingChargePaymentService = {
      execute: chargeExecuteMock,
    } as unknown as ChargePaymentService;

    const spyingService = new SettleBillPaymentService(
      prisma,
      offlinePaymentRecorder,
      spyingChargePaymentService,
      finalizePaymentService,
      failPaymentService,
    );

    const checkout = {
      cardToken: 'card-token-1',
      paymentMethodId: 'visa',
      installments: 1,
    };

    await expect(
      spyingService.execute(
        PaymentChannel.QR_ONLINE,
        openBill,
        new Prisma.Decimal(10000),
        new Prisma.Decimal(0),
        checkout,
      ),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(chargeExecuteMock).toHaveBeenCalledWith(
      expect.objectContaining({ channel: PaymentChannel.QR_ONLINE, checkout }),
    );
  });
});

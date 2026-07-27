import { OrderStatus, PaymentAttemptStatus, Prisma } from '@prisma/client';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import { FailPaymentService } from './fail-payment.service';
import { FinalizePaymentService } from './finalize-payment.service';
import { HandleMercadoPagoWebhookService } from './handle-mercado-pago-webhook.service';
import type { PaymentGatewayResolverPort } from './ports/payment-gateway-resolver.port';
import type { PaymentGatewayPort } from './ports/payment-gateway.port';
import type { RestaurantPaymentAccountRepository } from '../infrastructure/mercado-pago/restaurant-payment-account.repository';

describe('HandleMercadoPagoWebhookService', () => {
  const paymentWebhookEventFindUniqueMock = jest.fn();
  const paymentWebhookEventCreateMock = jest.fn();
  const paymentWebhookEventUpdateMock = jest.fn();
  const paymentAttemptFindFirstMock = jest.fn();
  const paymentAttemptFindUniqueMock = jest.fn();
  const paymentAttemptUpdateMock = jest.fn();
  const billFindUniqueMock = jest.fn();
  const orderFindUniqueMock = jest.fn();
  const transactionMock = jest.fn();

  const prisma = {
    paymentWebhookEvent: {
      findUnique: paymentWebhookEventFindUniqueMock,
      create: paymentWebhookEventCreateMock,
      update: paymentWebhookEventUpdateMock,
    },
    paymentAttempt: {
      findFirst: paymentAttemptFindFirstMock,
      findUnique: paymentAttemptFindUniqueMock,
      update: paymentAttemptUpdateMock,
    },
    bill: {
      findUnique: billFindUniqueMock,
    },
    order: {
      findUnique: orderFindUniqueMock,
    },
    $transaction: transactionMock,
  } as unknown as PrismaService;

  const getPaymentMock = jest.fn();
  const gateway: PaymentGatewayPort = {
    providerName: 'MERCADO_PAGO',
    charge: jest.fn(),
    getPayment: getPaymentMock,
  };

  const resolveMock = jest.fn();
  const paymentGatewayResolver: PaymentGatewayResolverPort = {
    resolve: resolveMock,
  };

  const findByExternalAccountIdMock = jest.fn();
  const restaurantPaymentAccountRepository = {
    findByExternalAccountId: findByExternalAccountIdMock,
  } as unknown as RestaurantPaymentAccountRepository;

  const finalizePaymentService = new FinalizePaymentService();
  const failPaymentService = new FailPaymentService();

  let service: HandleMercadoPagoWebhookService;

  beforeEach(() => {
    jest.clearAllMocks();
    paymentWebhookEventCreateMock.mockResolvedValue({ id: 'event-1' });
    paymentWebhookEventUpdateMock.mockResolvedValue({});
    resolveMock.mockResolvedValue({
      gateway,
      accountId: 'account-1',
      publicKey: null,
      environment: 'sandbox',
    });
    service = new HandleMercadoPagoWebhookService(
      prisma,
      paymentGatewayResolver,
      restaurantPaymentAccountRepository,
      finalizePaymentService,
      failPaymentService,
    );
  });

  const pendingAttempt = {
    id: 'attempt-1',
    orderId: null,
    billId: 'bill-1',
    restaurantPaymentAccountId: null,
    amount: new Prisma.Decimal(11800),
    provider: 'MERCADO_PAGO',
    providerReference: '999999999',
    providerStatus: null,
    providerStatusDetail: null,
    status: PaymentAttemptStatus.PENDING,
    failureReason: null,
    createdAt: new Date('2026-07-27T12:00:00.000Z'),
    updatedAt: new Date('2026-07-27T12:00:00.000Z'),
  };

  const billWithBranch = {
    branch: {
      restaurantId: 'restaurant-1',
      restaurant: { currency: 'CLP' },
    },
  };

  it('cuts early on a duplicate eventId and never touches the gateway or the correlation lookups', async () => {
    paymentWebhookEventFindUniqueMock.mockResolvedValue({ id: 'existing-1' });

    const result = await service.execute({
      body: { id: 555, type: 'payment', data: { id: '999999999' } },
      dataId: '999999999',
    });

    expect(result).toEqual({ status: 'DUPLICATE' });
    expect(paymentWebhookEventCreateMock).not.toHaveBeenCalled();
    expect(resolveMock).not.toHaveBeenCalled();
    expect(paymentAttemptFindFirstMock).not.toHaveBeenCalled();
    expect(getPaymentMock).not.toHaveBeenCalled();
  });

  it('records and ignores notifications for topics other than payment', async () => {
    paymentWebhookEventFindUniqueMock.mockResolvedValue(null);

    const result = await service.execute({
      body: { id: 556, type: 'merchant_order', data: { id: '999999999' } },
      dataId: '999999999',
    });

    expect(result).toEqual({ status: 'IGNORED' });
    expect(paymentWebhookEventCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          provider: 'MERCADO_PAGO',
          eventId: '556',
          eventType: 'merchant_order',
        }),
      }),
    );
    expect(paymentAttemptFindFirstMock).not.toHaveBeenCalled();
    expect(paymentWebhookEventUpdateMock).toHaveBeenCalledWith({
      where: { id: 'event-1' },
      data: { processedAt: expect.any(Date), processError: null },
    });
  });

  it('correlates by providerReference, reconsults the gateway and finalizes an approved payment left PENDING', async () => {
    paymentWebhookEventFindUniqueMock.mockResolvedValue(null);
    paymentAttemptFindFirstMock.mockResolvedValue(pendingAttempt);
    billFindUniqueMock.mockResolvedValue(billWithBranch);
    getPaymentMock.mockResolvedValue({
      providerReference: '999999999',
      outcome: 'APPROVED',
      rawStatus: 'approved',
    });

    const txAttemptUpdateManyMock = jest.fn().mockResolvedValue({ count: 1 });
    const txPaymentCreateMock = jest.fn().mockResolvedValue({
      id: 'payment-1',
      billId: 'bill-1',
      amount: new Prisma.Decimal(11800),
      currency: 'CLP',
      provider: 'MERCADO_PAGO',
      providerReference: '999999999',
      status: 'PAID',
      paidAt: new Date('2026-07-27T12:00:00.000Z'),
    });
    const txBillFindUniqueOrThrowMock = jest.fn().mockResolvedValue({
      id: 'bill-1',
      tableSessionId: 'session-1',
      status: 'OPEN',
      subtotalAmount: new Prisma.Decimal(11800),
      tipAmount: new Prisma.Decimal(0),
      taxAmount: new Prisma.Decimal(0),
      totalAmount: new Prisma.Decimal(11800),
      remainingAmount: new Prisma.Decimal(11800),
    });
    const txBillUpdateMock = jest.fn().mockResolvedValue({});
    const txSessionUpdateManyMock = jest.fn().mockResolvedValue({ count: 1 });

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

    const result = await service.execute({
      body: { id: 557, type: 'payment', data: { id: '999999999' } },
      dataId: '999999999',
    });

    expect(result).toEqual({ status: 'PROCESSED' });
    expect(resolveMock).toHaveBeenCalledWith('restaurant-1');
    expect(getPaymentMock).toHaveBeenCalledWith('999999999');
    expect(txAttemptUpdateManyMock).toHaveBeenCalledWith({
      where: { id: 'attempt-1', status: PaymentAttemptStatus.PENDING },
      data: expect.objectContaining({
        status: 'SUCCEEDED',
        providerReference: '999999999',
      }),
    });
    expect(txBillUpdateMock).toHaveBeenCalled();
    expect(paymentWebhookEventUpdateMock).toHaveBeenCalledWith({
      where: { id: 'event-1' },
      data: { processedAt: expect.any(Date), processError: null },
    });
  });

  it('does not re-finalize an attempt that already left the PENDING state, only records the provider status', async () => {
    paymentWebhookEventFindUniqueMock.mockResolvedValue(null);
    paymentAttemptFindFirstMock.mockResolvedValue({
      ...pendingAttempt,
      status: PaymentAttemptStatus.SUCCEEDED,
    });
    billFindUniqueMock.mockResolvedValue(billWithBranch);
    getPaymentMock.mockResolvedValue({
      providerReference: '999999999',
      outcome: 'APPROVED',
      rawStatus: 'approved',
    });

    const result = await service.execute({
      body: { id: 558, type: 'payment', data: { id: '999999999' } },
      dataId: '999999999',
    });

    expect(result).toEqual({ status: 'PROCESSED' });
    expect(transactionMock).not.toHaveBeenCalled();
    expect(paymentAttemptUpdateMock).toHaveBeenCalledWith({
      where: { id: 'attempt-1' },
      data: { providerStatus: 'approved', providerStatusDetail: null },
    });
  });

  it('does nothing beyond recording the provider status when Mercado Pago still reports in_process/pending', async () => {
    paymentWebhookEventFindUniqueMock.mockResolvedValue(null);
    paymentAttemptFindFirstMock.mockResolvedValue(pendingAttempt);
    billFindUniqueMock.mockResolvedValue(billWithBranch);
    getPaymentMock.mockResolvedValue({
      providerReference: '999999999',
      outcome: 'PENDING',
      rawStatus: 'in_process',
    });

    const result = await service.execute({
      body: { id: 559, type: 'payment', data: { id: '999999999' } },
      dataId: '999999999',
    });

    expect(result).toEqual({ status: 'PROCESSED' });
    expect(transactionMock).not.toHaveBeenCalled();
    expect(paymentAttemptUpdateMock).toHaveBeenCalledWith({
      where: { id: 'attempt-1' },
      data: { providerStatus: 'in_process', providerStatusDetail: null },
    });
  });

  it('fails a rejected attempt and marks its order as PAYMENT_FAILED when the attempt came from a QR order', async () => {
    paymentWebhookEventFindUniqueMock.mockResolvedValue(null);
    paymentAttemptFindFirstMock.mockResolvedValue({
      ...pendingAttempt,
      orderId: 'order-1',
    });
    billFindUniqueMock.mockResolvedValue(billWithBranch);
    getPaymentMock.mockResolvedValue({
      providerReference: '999999999',
      outcome: 'REJECTED',
      rawStatus: 'rejected',
      rawStatusDetail: 'cc_rejected_other_reason',
    });

    const txAttemptUpdateManyMock = jest.fn().mockResolvedValue({ count: 1 });
    const txOrderUpdateManyMock = jest.fn().mockResolvedValue({ count: 1 });

    transactionMock.mockImplementation(
      (callback: (tx: unknown) => Promise<unknown>) =>
        callback({
          paymentAttempt: { updateMany: txAttemptUpdateManyMock },
          order: { updateMany: txOrderUpdateManyMock },
        }),
    );

    const result = await service.execute({
      body: { id: 560, type: 'payment', data: { id: '999999999' } },
      dataId: '999999999',
    });

    expect(result).toEqual({ status: 'PROCESSED' });
    expect(txAttemptUpdateManyMock).toHaveBeenCalledWith({
      where: { id: 'attempt-1', status: PaymentAttemptStatus.PENDING },
      data: expect.objectContaining({ status: 'FAILED' }),
    });
    expect(txOrderUpdateManyMock).toHaveBeenCalledWith({
      where: {
        id: 'order-1',
        status: {
          in: [OrderStatus.AWAITING_PAYMENT, OrderStatus.PAYMENT_FAILED],
        },
      },
      data: { status: OrderStatus.PAYMENT_FAILED },
    });
  });

  it('defers when no attempt can be correlated by providerReference and the body has no user_id fallback', async () => {
    paymentWebhookEventFindUniqueMock.mockResolvedValue(null);
    paymentAttemptFindFirstMock.mockResolvedValue(null);

    const result = await service.execute({
      body: { id: 561, type: 'payment', data: { id: '999999999' } },
      dataId: '999999999',
    });

    expect(result).toEqual({ status: 'DEFERRED' });
    expect(resolveMock).not.toHaveBeenCalled();
    expect(paymentWebhookEventUpdateMock).toHaveBeenCalledWith({
      where: { id: 'event-1' },
      data: { processedAt: expect.any(Date), processError: expect.any(String) },
    });
  });

  it('falls back to external_reference correlation via user_id when providerReference is unknown', async () => {
    paymentWebhookEventFindUniqueMock.mockResolvedValue(null);
    paymentAttemptFindFirstMock.mockResolvedValue(null);
    findByExternalAccountIdMock.mockResolvedValue({
      id: 'account-1',
      restaurantId: 'restaurant-1',
    });
    getPaymentMock.mockResolvedValue({
      providerReference: '999999999',
      outcome: 'PENDING',
      rawStatus: 'pending',
      externalReference: 'attempt-1',
    });
    paymentAttemptFindUniqueMock.mockResolvedValue(pendingAttempt);
    billFindUniqueMock.mockResolvedValue(billWithBranch);

    const result = await service.execute({
      body: {
        id: 562,
        type: 'payment',
        user_id: 44444,
        data: { id: '999999999' },
      },
      dataId: '999999999',
    });

    expect(result).toEqual({ status: 'PROCESSED' });
    expect(findByExternalAccountIdMock).toHaveBeenCalledWith('44444');
    expect(getPaymentMock).toHaveBeenCalledTimes(1);
    expect(paymentAttemptUpdateMock).toHaveBeenCalledWith({
      where: { id: 'attempt-1' },
      data: { providerStatus: 'pending', providerStatusDetail: null },
    });
  });
});

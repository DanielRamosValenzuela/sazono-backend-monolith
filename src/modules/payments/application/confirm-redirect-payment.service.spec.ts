import {
  BillSplitParticipantStatus,
  BillStatus,
  OrderStatus,
  PaymentAttemptStatus,
  PaymentStatus,
  Prisma,
} from '@prisma/client';
import type { PaymentAttempt } from '@prisma/client';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import { ConfirmRedirectPaymentService } from './confirm-redirect-payment.service';
import { FailPaymentService } from './fail-payment.service';
import { FinalizePaymentService } from './finalize-payment.service';
import type { PaymentGatewayRegistry } from '../infrastructure/payment-gateway-registry.service';
import type { PaymentGatewayResolverPort } from './ports/payment-gateway-resolver.port';
import type { PaymentGatewayPort } from './ports/payment-gateway.port';

describe('ConfirmRedirectPaymentService', () => {
  const attemptFindFirstMock = jest.fn();
  const attemptUpdateManyMock = jest.fn().mockResolvedValue({ count: 1 });
  const paymentFindUniqueMock = jest.fn();
  const billFindUniqueOrThrowMock = jest.fn();
  const orderFindUniqueMock = jest.fn();
  const billFindUniqueMock = jest.fn();
  const transactionMock = jest.fn();

  const prisma = {
    paymentAttempt: {
      findFirst: attemptFindFirstMock,
      updateMany: attemptUpdateManyMock,
    },
    payment: { findUnique: paymentFindUniqueMock },
    bill: {
      findUniqueOrThrow: billFindUniqueOrThrowMock,
      findUnique: billFindUniqueMock,
    },
    order: { findUnique: orderFindUniqueMock },
    $transaction: transactionMock,
  } as unknown as PrismaService;

  const confirmRedirectMock = jest.fn();
  const getPaymentMock = jest.fn();
  const transbankGateway: PaymentGatewayPort = {
    providerName: 'TRANSBANK',
    checkoutMode: 'redirect',
    charge: jest.fn(),
    confirmRedirect: confirmRedirectMock,
    getPayment: getPaymentMock,
  };

  const registryGetMock = jest.fn();
  const registryGetAllMock = jest.fn();
  const paymentGatewayRegistry = {
    get: registryGetMock,
    getAll: registryGetAllMock,
  } as unknown as PaymentGatewayRegistry;

  const resolveAvailableMock = jest.fn();
  const paymentGatewayResolver: PaymentGatewayResolverPort = {
    resolveAvailable: resolveAvailableMock,
  };

  const finalizePaymentService = new FinalizePaymentService();
  const failPaymentService = new FailPaymentService();

  let service: ConfirmRedirectPaymentService;

  beforeEach(() => {
    jest.clearAllMocks();
    registryGetMock.mockReturnValue(transbankGateway);
    registryGetAllMock.mockReturnValue([transbankGateway]);
    resolveAvailableMock.mockResolvedValue([
      {
        provider: 'TRANSBANK',
        gateway: transbankGateway,
        accountId: 'account-1',
        publicKey: null,
        environment: 'integration',
        checkoutMode: 'redirect',
        displayPriority: 0,
        credentials: { childCommerceCode: '597055555536' },
      },
    ]);
    billFindUniqueMock.mockResolvedValue({
      branch: {
        restaurantId: 'restaurant-1',
        restaurant: { currency: 'CLP' },
      },
    });
    service = new ConfirmRedirectPaymentService(
      prisma,
      paymentGatewayRegistry,
      paymentGatewayResolver,
      finalizePaymentService,
      failPaymentService,
    );
  });

  describe('execute', () => {
    it('reports TIMEOUT and touches nothing when neither token_ws nor TBK_TOKEN are present', async () => {
      const result = await service.execute({});

      expect(result.status).toBe('TIMEOUT');
      expect(result.payment).toBeNull();
      expect(attemptFindFirstMock).not.toHaveBeenCalled();
      expect(confirmRedirectMock).not.toHaveBeenCalled();
    });

    it('reports ABORTED and fails the attempt without calling confirmRedirect when only TBK_TOKEN is present', async () => {
      attemptFindFirstMock.mockResolvedValue({
        id: 'attempt-1',
        orderId: null,
        billId: 'bill-1',
        billSplitParticipantId: null,
        amount: new Prisma.Decimal(11800),
        tipAmount: new Prisma.Decimal(0),
        provider: 'TRANSBANK',
        providerReference: 'tbk-token-1',
        status: PaymentAttemptStatus.PENDING,
        failureReason: null,
      });

      const txAttemptUpdateManyMock = jest.fn().mockResolvedValue({ count: 1 });
      const txOrderUpdateManyMock = jest.fn();
      transactionMock.mockImplementation(
        (callback: (tx: unknown) => Promise<unknown>) =>
          callback({
            paymentAttempt: { updateMany: txAttemptUpdateManyMock },
            order: { updateMany: txOrderUpdateManyMock },
          }),
      );

      const result = await service.execute({ tbkToken: 'tbk-token-1' });

      expect(result.status).toBe('ABORTED');
      expect(confirmRedirectMock).not.toHaveBeenCalled();
      expect(txAttemptUpdateManyMock).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'attempt-1', status: PaymentAttemptStatus.PENDING },
          data: expect.objectContaining({
            status: PaymentAttemptStatus.FAILED,
          }),
        }),
      );
      expect(txOrderUpdateManyMock).not.toHaveBeenCalled();
    });

    it('reports ABORTED without touching the database when no attempt matches TBK_TOKEN', async () => {
      attemptFindFirstMock.mockResolvedValue(null);

      const result = await service.execute({ tbkToken: 'unknown-token' });

      expect(result.status).toBe('ABORTED');
      expect(transactionMock).not.toHaveBeenCalled();
    });
  });

  describe('confirming token_ws for a QR order attempt', () => {
    const orderAttempt = {
      id: 'attempt-1',
      orderId: 'order-1',
      billId: 'bill-1',
      billSplitParticipantId: null,
      amount: new Prisma.Decimal(11800),
      tipAmount: new Prisma.Decimal(0),
      provider: 'TRANSBANK',
      providerReference: 'tbk-token-1',
      status: PaymentAttemptStatus.PENDING,
      failureReason: null,
    };

    it('finalizes the payment, charges the bill and routes the order to stations when approved', async () => {
      attemptFindFirstMock.mockResolvedValue(orderAttempt);
      confirmRedirectMock.mockResolvedValue({
        kind: 'SETTLED',
        result: 'APPROVED',
        providerReference: 'tbk-token-1',
        rawStatus: 'AUTHORIZED',
        rawStatusDetail: '0',
      });

      const txOrderFindUniqueMock = jest.fn().mockResolvedValue({
        id: 'order-1',
        branchId: 'branch-1',
        status: OrderStatus.AWAITING_PAYMENT,
        orderItems: [
          {
            id: 'order-item-1',
            nameSnapshot: 'Pisco Sour',
            priceSnapshot: new Prisma.Decimal(5900),
            quantity: 2,
            preparationStationId: 'station-bar',
          },
        ],
      });
      const txAttemptUpdateManyMock = jest.fn().mockResolvedValue({ count: 1 });
      const txPaymentCreateMock = jest.fn().mockResolvedValue({
        id: 'payment-1',
        billId: 'bill-1',
        amount: new Prisma.Decimal(11800),
        currency: 'CLP',
        provider: 'TRANSBANK',
        providerReference: 'tbk-token-1',
        status: PaymentStatus.PAID,
        paidAt: new Date('2026-07-27T12:00:00.000Z'),
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
      const txBillItemCreateManyMock = jest
        .fn()
        .mockResolvedValue({ count: 1 });
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
              findUnique: txOrderFindUniqueMock,
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

      const result = await service.execute({ tokenWs: 'tbk-token-1' });

      expect(confirmRedirectMock).toHaveBeenCalledWith('tbk-token-1', {
        childCommerceCode: '597055555536',
      });
      expect(result.status).toBe('APPROVED');
      expect(result.payment?.order?.status).toBe(OrderStatus.ROUTED);
      expect(result.payment?.bill.status).toBe(BillStatus.PAID);
      expect(txStationTicketCreateMock).toHaveBeenCalledTimes(1);
      expect(txSessionUpdateManyMock).toHaveBeenCalled();
    });

    it('marks the order PAYMENT_FAILED and does not call confirmRedirect again when the gateway rejects', async () => {
      attemptFindFirstMock.mockResolvedValue(orderAttempt);
      confirmRedirectMock.mockResolvedValue({
        kind: 'SETTLED',
        result: 'REJECTED',
        providerReference: 'tbk-token-1',
        failureReason: 'El medio de pago rechazo el cobro, intenta con otro.',
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

      const result = await service.execute({ tokenWs: 'tbk-token-1' });

      expect(result.status).toBe('REJECTED');
      expect(result.payment).toBeNull();
      expect(txOrderUpdateManyMock).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            id: 'order-1',
            status: {
              in: [OrderStatus.AWAITING_PAYMENT, OrderStatus.PAYMENT_FAILED],
            },
          },
          data: { status: OrderStatus.PAYMENT_FAILED },
        }),
      );
    });
  });

  describe('confirming token_ws for a bill split participant attempt', () => {
    const splitAttempt = {
      id: 'attempt-2',
      orderId: null,
      billId: 'bill-1',
      billSplitParticipantId: 'participant-1',
      amount: new Prisma.Decimal(6900),
      tipAmount: new Prisma.Decimal(900),
      provider: 'TRANSBANK',
      providerReference: 'tbk-token-2',
      status: PaymentAttemptStatus.PENDING,
      failureReason: null,
    };

    it('updates the participant paidAmount/status and the split status when approved', async () => {
      attemptFindFirstMock.mockResolvedValue(splitAttempt);
      confirmRedirectMock.mockResolvedValue({
        kind: 'SETTLED',
        result: 'APPROVED',
        providerReference: 'tbk-token-2',
      });

      const txParticipantFindUniqueMock = jest.fn().mockResolvedValue({
        id: 'participant-1',
        billSplitId: 'split-1',
        allocatedAmount: new Prisma.Decimal(6000),
        paidAmount: new Prisma.Decimal(0),
        status: BillSplitParticipantStatus.PENDING,
      });
      const txParticipantUpdateMock = jest.fn().mockResolvedValue({});
      const txBillSplitParticipantFindManyMock = jest
        .fn()
        .mockResolvedValue([{ status: BillSplitParticipantStatus.PAID }]);
      const txBillSplitUpdateMock = jest.fn().mockResolvedValue({});
      const txAttemptUpdateManyMock = jest.fn().mockResolvedValue({ count: 1 });
      const txPaymentCreateMock = jest.fn().mockResolvedValue({
        id: 'payment-2',
        billId: 'bill-1',
        amount: new Prisma.Decimal(6900),
        currency: 'CLP',
        provider: 'TRANSBANK',
        providerReference: 'tbk-token-2',
        status: PaymentStatus.PAID,
        paidAt: new Date('2026-07-27T12:00:00.000Z'),
      });
      const txBillFindUniqueOrThrowMock = jest.fn().mockResolvedValue({
        id: 'bill-1',
        tableSessionId: 'session-1',
        status: BillStatus.PARTIALLY_PAID,
        subtotalAmount: new Prisma.Decimal(23600),
        tipAmount: new Prisma.Decimal(900),
        taxAmount: new Prisma.Decimal(0),
        totalAmount: new Prisma.Decimal(24500),
        remainingAmount: new Prisma.Decimal(6900),
      });
      const txBillUpdateMock = jest.fn().mockResolvedValue({});
      const txSessionUpdateManyMock = jest.fn().mockResolvedValue({ count: 0 });

      transactionMock.mockImplementation(
        (callback: (tx: unknown) => Promise<unknown>) =>
          callback({
            billSplitParticipant: {
              findUnique: txParticipantFindUniqueMock,
              update: txParticipantUpdateMock,
              findMany: txBillSplitParticipantFindManyMock,
            },
            billSplit: { update: txBillSplitUpdateMock },
            paymentAttempt: { updateMany: txAttemptUpdateManyMock },
            payment: { create: txPaymentCreateMock },
            bill: {
              findUniqueOrThrow: txBillFindUniqueOrThrowMock,
              update: txBillUpdateMock,
            },
            tableSession: { updateMany: txSessionUpdateManyMock },
          }),
      );

      const result = await service.execute({ tokenWs: 'tbk-token-2' });

      expect(result.status).toBe('APPROVED');
      expect(txParticipantUpdateMock).toHaveBeenCalledWith({
        where: { id: 'participant-1' },
        data: {
          paidAmount: new Prisma.Decimal(6000),
          status: BillSplitParticipantStatus.PAID,
        },
      });
      expect(txBillSplitUpdateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'split-1' },
          data: { status: 'PAID' },
        }),
      );
    });
  });

  describe('idempotency', () => {
    it('reuses the already-finalized payment without calling confirmRedirect again', async () => {
      attemptFindFirstMock.mockResolvedValue({
        id: 'attempt-1',
        orderId: null,
        billId: 'bill-1',
        billSplitParticipantId: null,
        amount: new Prisma.Decimal(11800),
        tipAmount: new Prisma.Decimal(0),
        provider: 'TRANSBANK',
        providerReference: 'tbk-token-1',
        status: PaymentAttemptStatus.SUCCEEDED,
        failureReason: null,
      });
      paymentFindUniqueMock.mockResolvedValue({
        id: 'payment-1',
        billId: 'bill-1',
        amount: new Prisma.Decimal(11800),
        currency: 'CLP',
        provider: 'TRANSBANK',
        providerReference: 'tbk-token-1',
        status: PaymentStatus.PAID,
        paidAt: new Date('2026-07-27T12:00:00.000Z'),
      });
      billFindUniqueOrThrowMock.mockResolvedValue({
        id: 'bill-1',
        status: BillStatus.PAID,
        subtotalAmount: new Prisma.Decimal(11800),
        tipAmount: new Prisma.Decimal(0),
        taxAmount: new Prisma.Decimal(0),
        totalAmount: new Prisma.Decimal(11800),
        remainingAmount: new Prisma.Decimal(0),
      });
      orderFindUniqueMock.mockResolvedValue(null);

      const result = await service.execute({ tokenWs: 'tbk-token-1' });

      expect(result.status).toBe('APPROVED');
      expect(result.payment?.paymentId).toBe('payment-1');
      expect(confirmRedirectMock).not.toHaveBeenCalled();
      expect(transactionMock).not.toHaveBeenCalled();
    });

    it('reuses a previously-failed attempt as REJECTED without calling confirmRedirect again', async () => {
      attemptFindFirstMock.mockResolvedValue({
        id: 'attempt-1',
        orderId: null,
        billId: 'bill-1',
        billSplitParticipantId: null,
        amount: new Prisma.Decimal(11800),
        tipAmount: new Prisma.Decimal(0),
        provider: 'TRANSBANK',
        providerReference: 'tbk-token-1',
        status: PaymentAttemptStatus.FAILED,
        failureReason: 'El cliente cancelo el pago en la pasarela.',
      });

      const result = await service.execute({ tokenWs: 'tbk-token-1' });

      expect(result.status).toBe('REJECTED');
      expect(result.failureReason).toBe(
        'El cliente cancelo el pago en la pasarela.',
      );
      expect(confirmRedirectMock).not.toHaveBeenCalled();
    });
  });

  describe('reconcilePendingAttempt', () => {
    const pendingOrderAttempt = {
      id: 'attempt-5',
      orderId: 'order-5',
      billId: 'bill-5',
      billSplitParticipantId: null,
      amount: new Prisma.Decimal(11800),
      tipAmount: new Prisma.Decimal(0),
      provider: 'TRANSBANK',
      providerReference: 'tbk-token-5',
      status: PaymentAttemptStatus.PENDING,
      failureReason: null,
    } as unknown as PaymentAttempt;

    it('fails the attempt and marks the order PAYMENT_FAILED without calling getPayment when no adapter is registered', async () => {
      registryGetMock.mockReturnValue(undefined);
      const txAttemptUpdateManyMock = jest.fn().mockResolvedValue({ count: 1 });
      const txOrderUpdateManyMock = jest.fn().mockResolvedValue({ count: 1 });
      transactionMock.mockImplementation(
        (callback: (tx: unknown) => Promise<unknown>) =>
          callback({
            paymentAttempt: { updateMany: txAttemptUpdateManyMock },
            order: { updateMany: txOrderUpdateManyMock },
          }),
      );

      const result = await service.reconcilePendingAttempt(pendingOrderAttempt);

      expect(result).toEqual({
        kind: 'REJECTED',
        failureReason:
          'La pasarela de pago de este intento ya no esta registrada.',
      });
      expect(getPaymentMock).not.toHaveBeenCalled();
      expect(txOrderUpdateManyMock).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            id: 'order-5',
            status: {
              in: [OrderStatus.AWAITING_PAYMENT, OrderStatus.PAYMENT_FAILED],
            },
          },
          data: { status: OrderStatus.PAYMENT_FAILED },
        }),
      );
    });

    it('fails the attempt without calling getPayment when the attempt has no providerReference', async () => {
      const attemptWithoutReference = {
        ...pendingOrderAttempt,
        providerReference: null,
      } as unknown as PaymentAttempt;
      const txAttemptUpdateManyMock = jest.fn().mockResolvedValue({ count: 1 });
      const txOrderUpdateManyMock = jest.fn().mockResolvedValue({ count: 1 });
      transactionMock.mockImplementation(
        (callback: (tx: unknown) => Promise<unknown>) =>
          callback({
            paymentAttempt: { updateMany: txAttemptUpdateManyMock },
            order: { updateMany: txOrderUpdateManyMock },
          }),
      );

      const result = await service.reconcilePendingAttempt(
        attemptWithoutReference,
      );

      expect(result.kind).toBe('REJECTED');
      expect(getPaymentMock).not.toHaveBeenCalled();
    });

    it('fails the attempt with a clear reason when Transbank has no record of the transaction', async () => {
      getPaymentMock.mockResolvedValue(null);
      const txAttemptUpdateManyMock = jest.fn().mockResolvedValue({ count: 1 });
      const txOrderUpdateManyMock = jest.fn().mockResolvedValue({ count: 1 });
      transactionMock.mockImplementation(
        (callback: (tx: unknown) => Promise<unknown>) =>
          callback({
            paymentAttempt: { updateMany: txAttemptUpdateManyMock },
            order: { updateMany: txOrderUpdateManyMock },
          }),
      );

      const result = await service.reconcilePendingAttempt(pendingOrderAttempt);

      expect(getPaymentMock).toHaveBeenCalledWith('tbk-token-5', {
        childCommerceCode: '597055555536',
      });
      expect(result).toEqual({
        kind: 'REJECTED',
        failureReason:
          'La pasarela de pago no tiene un registro de esta transaccion. El intento se marca como fallido.',
      });
      expect(txOrderUpdateManyMock).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { status: OrderStatus.PAYMENT_FAILED },
        }),
      );
    });

    it('approves and finalizes the order exactly like the normal confirmation flow when Transbank reports AUTHORIZED late', async () => {
      getPaymentMock.mockResolvedValue({
        providerReference: 'tbk-token-5',
        outcome: 'APPROVED',
        rawStatus: 'AUTHORIZED',
        rawStatusDetail: '0',
      });

      const txOrderFindUniqueMock = jest.fn().mockResolvedValue({
        id: 'order-5',
        branchId: 'branch-1',
        status: OrderStatus.AWAITING_PAYMENT,
        orderItems: [
          {
            id: 'order-item-1',
            nameSnapshot: 'Pisco Sour',
            priceSnapshot: new Prisma.Decimal(5900),
            quantity: 2,
            preparationStationId: 'station-bar',
          },
        ],
      });
      const txAttemptUpdateManyMock = jest.fn().mockResolvedValue({ count: 1 });
      const txPaymentCreateMock = jest.fn().mockResolvedValue({
        id: 'payment-5',
        billId: 'bill-5',
        amount: new Prisma.Decimal(11800),
        currency: 'CLP',
        provider: 'TRANSBANK',
        providerReference: 'tbk-token-5',
        status: PaymentStatus.PAID,
        paidAt: new Date('2026-07-27T12:00:00.000Z'),
      });
      const txBillFindUniqueOrThrowMock = jest
        .fn()
        .mockResolvedValueOnce({
          id: 'bill-5',
          tableSessionId: 'session-5',
          status: BillStatus.OPEN,
          subtotalAmount: new Prisma.Decimal(0),
          tipAmount: new Prisma.Decimal(0),
          taxAmount: new Prisma.Decimal(0),
          totalAmount: new Prisma.Decimal(0),
          remainingAmount: new Prisma.Decimal(0),
        })
        .mockResolvedValueOnce({
          id: 'bill-5',
          tableSessionId: 'session-5',
          status: BillStatus.OPEN,
          subtotalAmount: new Prisma.Decimal(11800),
          tipAmount: new Prisma.Decimal(0),
          taxAmount: new Prisma.Decimal(0),
          totalAmount: new Prisma.Decimal(11800),
          remainingAmount: new Prisma.Decimal(11800),
        });
      const txBillItemCreateManyMock = jest
        .fn()
        .mockResolvedValue({ count: 1 });
      const txBillUpdateMock = jest.fn().mockResolvedValue({});
      const txSessionUpdateManyMock = jest.fn().mockResolvedValue({ count: 1 });
      const txStationTicketCreateMock = jest.fn().mockResolvedValue({});
      const txOrderUpdateMock = jest.fn().mockResolvedValue({
        id: 'order-5',
        status: OrderStatus.ROUTED,
      });

      transactionMock.mockImplementation(
        (callback: (tx: unknown) => Promise<unknown>) =>
          callback({
            order: {
              findUnique: txOrderFindUniqueMock,
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

      const result = await service.reconcilePendingAttempt(pendingOrderAttempt);

      expect(confirmRedirectMock).not.toHaveBeenCalled();
      expect(result.kind).toBe('APPROVED');
      if (result.kind === 'APPROVED') {
        expect(result.payment.order?.status).toBe(OrderStatus.ROUTED);
        expect(result.payment.bill.status).toBe(BillStatus.PAID);
      }
      expect(txStationTicketCreateMock).toHaveBeenCalledTimes(1);
    });

    it('rejects and marks the order PAYMENT_FAILED when Transbank reports the payment as rejected', async () => {
      getPaymentMock.mockResolvedValue({
        providerReference: 'tbk-token-5',
        outcome: 'REJECTED',
        rawStatus: 'FAILED',
        rawStatusDetail: '-1',
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

      const result = await service.reconcilePendingAttempt(pendingOrderAttempt);

      expect(result).toEqual({
        kind: 'REJECTED',
        failureReason: 'El pago fue rechazado por el proveedor.',
      });
      expect(txOrderUpdateManyMock).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { status: OrderStatus.PAYMENT_FAILED },
        }),
      );
    });

    it('leaves the attempt untouched and reports STILL_PENDING when the gateway snapshot is still pending', async () => {
      getPaymentMock.mockResolvedValue({
        providerReference: 'tbk-token-5',
        outcome: 'PENDING',
        rawStatus: 'INITIALIZED',
      });

      const result = await service.reconcilePendingAttempt(pendingOrderAttempt);

      expect(result).toEqual({ kind: 'STILL_PENDING' });
      expect(transactionMock).not.toHaveBeenCalled();
    });
  });
});

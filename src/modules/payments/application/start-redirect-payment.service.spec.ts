import { BadRequestException, ConflictException } from '@nestjs/common';
import {
  BillStatus,
  BillSplitParticipantStatus,
  OrderStatus,
  PaymentAttemptStatus,
  PaymentGatewayProvider,
  Prisma,
  TableStatus,
} from '@prisma/client';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import { FailPaymentService } from './fail-payment.service';
import { StartRedirectPaymentService } from './start-redirect-payment.service';
import type {
  PaymentGatewayResolverPort,
  ResolvedPaymentGateway,
} from './ports/payment-gateway-resolver.port';

describe('StartRedirectPaymentService', () => {
  const tableFindUniqueMock = jest.fn();
  const orderFindUniqueMock = jest.fn();
  const tableSessionFindFirstMock = jest.fn();
  const billSplitParticipantFindFirstMock = jest.fn();
  const attemptCreateMock = jest.fn();
  const attemptUpdateMock = jest.fn();
  const attemptUpdateManyMock = jest.fn().mockResolvedValue({ count: 1 });
  const prisma = {
    table: { findUnique: tableFindUniqueMock },
    order: { findUnique: orderFindUniqueMock },
    tableSession: { findFirst: tableSessionFindFirstMock },
    billSplitParticipant: { findFirst: billSplitParticipantFindFirstMock },
    paymentAttempt: {
      create: attemptCreateMock,
      update: attemptUpdateMock,
      updateMany: attemptUpdateManyMock,
    },
  } as unknown as PrismaService;

  const resolveAvailableMock = jest.fn();
  const paymentGatewayResolver: PaymentGatewayResolverPort = {
    resolveAvailable: resolveAvailableMock,
  };

  const failPaymentService = new FailPaymentService();
  const failExecuteSpy = jest.spyOn(failPaymentService, 'execute');

  let service: StartRedirectPaymentService;

  const chargeMock = jest.fn();
  const transbankGateway: ResolvedPaymentGateway = {
    provider: PaymentGatewayProvider.TRANSBANK,
    gateway: {
      providerName: 'TRANSBANK',
      checkoutMode: 'redirect',
      charge: chargeMock,
      getPayment: jest.fn(),
    },
    accountId: 'account-1',
    publicKey: null,
    environment: 'integration',
    checkoutMode: 'redirect',
    displayPriority: 0,
    credentials: { childCommerceCode: '597055555536' },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    resolveAvailableMock.mockResolvedValue([transbankGateway]);
    service = new StartRedirectPaymentService(
      prisma,
      paymentGatewayResolver,
      failPaymentService,
    );
  });

  const table = { id: 'table-1', status: TableStatus.OCCUPIED };

  describe('startForQrOrder', () => {
    const awaitingOrder = {
      id: 'order-1',
      billId: 'bill-1',
      branchId: 'branch-1',
      status: OrderStatus.AWAITING_PAYMENT,
      tableSession: { tableId: 'table-1' },
      branch: {
        restaurantId: 'restaurant-1',
        restaurant: { currency: 'CLP' },
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

    it('creates a PENDING attempt, calls charge, persists the token and returns the redirect payload', async () => {
      tableFindUniqueMock.mockResolvedValue(table);
      orderFindUniqueMock.mockResolvedValue(awaitingOrder);
      attemptCreateMock.mockResolvedValue({ id: 'attempt-1' });
      const expiresAt = new Date('2026-07-27T12:10:00.000Z');
      chargeMock.mockResolvedValue({
        kind: 'REDIRECT',
        providerReference: 'tbk-token-1',
        redirectUrl: 'https://webpay3gint.transbank.cl/init',
        method: 'POST',
        fields: { token_ws: 'tbk-token-1' },
        expiresAt,
      });

      const result = await service.startForQrOrder('qr-token-1', 'order-1', {
        provider: PaymentGatewayProvider.TRANSBANK,
        tipAmount: '0',
      });

      expect(attemptCreateMock).toHaveBeenCalledWith({
        data: expect.objectContaining({
          orderId: 'order-1',
          billId: 'bill-1',
          amount: expect.any(Prisma.Decimal),
          tipAmount: expect.any(Prisma.Decimal),
          provider: 'TRANSBANK',
          status: PaymentAttemptStatus.PENDING,
        }),
      });
      expect(chargeMock).toHaveBeenCalledWith(
        expect.objectContaining({
          restaurantId: 'restaurant-1',
          attemptId: 'attempt-1',
          externalReference: 'attempt-1',
          credentials: { childCommerceCode: '597055555536' },
        }),
      );
      expect(attemptUpdateMock).toHaveBeenCalledWith({
        where: { id: 'attempt-1' },
        data: { providerReference: 'tbk-token-1' },
      });
      expect(result).toEqual({
        attemptId: 'attempt-1',
        provider: PaymentGatewayProvider.TRANSBANK,
        redirectUrl: 'https://webpay3gint.transbank.cl/init',
        method: 'POST',
        fields: { token_ws: 'tbk-token-1' },
        expiresAt: expiresAt.toISOString(),
      });
    });

    it('rejects when the requested provider has no connected redirect gateway', async () => {
      tableFindUniqueMock.mockResolvedValue(table);
      orderFindUniqueMock.mockResolvedValue(awaitingOrder);
      resolveAvailableMock.mockResolvedValue([]);

      await expect(
        service.startForQrOrder('qr-token-1', 'order-1', {
          provider: PaymentGatewayProvider.TRANSBANK,
        }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(attemptCreateMock).not.toHaveBeenCalled();
    });

    it('fails the attempt and throws when the gateway settles instead of redirecting', async () => {
      tableFindUniqueMock.mockResolvedValue(table);
      orderFindUniqueMock.mockResolvedValue(awaitingOrder);
      attemptCreateMock.mockResolvedValue({ id: 'attempt-1' });
      chargeMock.mockResolvedValue({
        kind: 'SETTLED',
        result: 'REJECTED',
        failureReason: 'Este restaurante no tiene un codigo de comercio.',
      });

      await expect(
        service.startForQrOrder('qr-token-1', 'order-1', {
          provider: PaymentGatewayProvider.TRANSBANK,
        }),
      ).rejects.toBeInstanceOf(ConflictException);

      expect(failExecuteSpy).toHaveBeenCalledWith(
        prisma,
        expect.objectContaining({
          attemptId: 'attempt-1',
          failureReason: 'Este restaurante no tiene un codigo de comercio.',
        }),
      );
    });

    it('rejects paying an order that is not awaiting payment', async () => {
      tableFindUniqueMock.mockResolvedValue(table);
      orderFindUniqueMock.mockResolvedValue({
        ...awaitingOrder,
        status: OrderStatus.ROUTED,
      });

      await expect(
        service.startForQrOrder('qr-token-1', 'order-1', {
          provider: PaymentGatewayProvider.TRANSBANK,
        }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(attemptCreateMock).not.toHaveBeenCalled();
    });
  });

  describe('startForQrBill', () => {
    const activeSession = {
      bill: {
        id: 'bill-1',
        status: BillStatus.OPEN,
        remainingAmount: new Prisma.Decimal(23600),
      },
      branch: {
        restaurantId: 'restaurant-1',
        restaurant: { currency: 'CLP' },
      },
    };

    it('starts a redirect payment for the open bill of the table', async () => {
      tableFindUniqueMock.mockResolvedValue(table);
      tableSessionFindFirstMock.mockResolvedValue(activeSession);
      attemptCreateMock.mockResolvedValue({ id: 'attempt-2' });
      const expiresAt = new Date('2026-07-27T12:10:00.000Z');
      chargeMock.mockResolvedValue({
        kind: 'REDIRECT',
        providerReference: 'tbk-token-2',
        redirectUrl: 'https://webpay3gint.transbank.cl/init',
        method: 'POST',
        fields: { token_ws: 'tbk-token-2' },
        expiresAt,
      });

      const result = await service.startForQrBill('qr-token-1', {
        provider: PaymentGatewayProvider.TRANSBANK,
        amount: '10000',
        tipAmount: '1000',
      });

      expect(attemptCreateMock).toHaveBeenCalledWith({
        data: expect.objectContaining({
          billId: 'bill-1',
          amount: new Prisma.Decimal(11000),
          tipAmount: new Prisma.Decimal(1000),
          provider: 'TRANSBANK',
        }),
      });
      expect(result.attemptId).toBe('attempt-2');
    });

    it('rejects an amount above the remaining balance', async () => {
      tableFindUniqueMock.mockResolvedValue(table);
      tableSessionFindFirstMock.mockResolvedValue(activeSession);

      await expect(
        service.startForQrBill('qr-token-1', {
          provider: PaymentGatewayProvider.TRANSBANK,
          amount: '99999',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(attemptCreateMock).not.toHaveBeenCalled();
    });

    it('rejects a negative tip', async () => {
      tableFindUniqueMock.mockResolvedValue(table);
      tableSessionFindFirstMock.mockResolvedValue(activeSession);

      await expect(
        service.startForQrBill('qr-token-1', {
          provider: PaymentGatewayProvider.TRANSBANK,
          amount: '1000',
          tipAmount: '-100',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(attemptCreateMock).not.toHaveBeenCalled();
    });
  });

  describe('startForSplitParticipant', () => {
    const participant = {
      id: 'participant-1',
      billSplitId: 'split-1',
      status: BillSplitParticipantStatus.PENDING,
      allocatedAmount: new Prisma.Decimal(11800),
      paidAmount: new Prisma.Decimal(0),
      billSplit: {
        bill: {
          id: 'bill-1',
          status: BillStatus.OPEN,
          branch: {
            restaurantId: 'restaurant-1',
            restaurant: { currency: 'CLP' },
          },
        },
      },
    };

    it('starts a redirect payment for the pending part of the participant', async () => {
      billSplitParticipantFindFirstMock.mockResolvedValue(participant);
      attemptCreateMock.mockResolvedValue({ id: 'attempt-3' });
      const expiresAt = new Date('2026-07-27T12:10:00.000Z');
      chargeMock.mockResolvedValue({
        kind: 'REDIRECT',
        providerReference: 'tbk-token-3',
        redirectUrl: 'https://webpay3gint.transbank.cl/init',
        method: 'POST',
        fields: { token_ws: 'tbk-token-3' },
        expiresAt,
      });

      const result = await service.startForSplitParticipant(
        'participant-token-1',
        { provider: PaymentGatewayProvider.TRANSBANK },
      );

      expect(attemptCreateMock).toHaveBeenCalledWith({
        data: expect.objectContaining({
          billId: 'bill-1',
          billSplitParticipantId: 'participant-1',
          amount: new Prisma.Decimal(11800),
          tipAmount: new Prisma.Decimal(0),
        }),
      });
      expect(result.attemptId).toBe('attempt-3');
    });

    it('rejects a participant that has no pending balance', async () => {
      billSplitParticipantFindFirstMock.mockResolvedValue({
        ...participant,
        paidAmount: new Prisma.Decimal(11800),
      });

      await expect(
        service.startForSplitParticipant('participant-token-1', {
          provider: PaymentGatewayProvider.TRANSBANK,
        }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(attemptCreateMock).not.toHaveBeenCalled();
    });
  });
});

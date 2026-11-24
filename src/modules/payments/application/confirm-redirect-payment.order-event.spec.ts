import type { EventEmitter2 } from '@nestjs/event-emitter';
import type { PaymentAttempt } from '@prisma/client';
import { OrderStatus, PaymentAttemptStatus, Prisma } from '@prisma/client';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import { ORDER_CREATED_EVENT } from '../../orders/domain/order-events';
import { ConfirmRedirectPaymentService } from './confirm-redirect-payment.service';
import type { FinalizePaymentService } from './finalize-payment.service';
import type { PaymentGatewayRegistry } from '../infrastructure/payment-gateway-registry.service';
import type { PaymentGatewayResolverPort } from './ports/payment-gateway-resolver.port';
import type { PaymentGatewayPort } from './ports/payment-gateway.port';

jest.mock('../../orders/application/apply-order-charge-to-bill', () => ({
  applyOrderChargeToBill: jest.fn().mockResolvedValue(undefined),
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

describe('ConfirmRedirectPaymentService order created event', () => {
  const attempt = {
    id: 'attempt-1',
    orderId: 'order-1',
    billId: 'bill-1',
    billSplitParticipantId: null,
    amount: new Prisma.Decimal(100),
    tipAmount: new Prisma.Decimal(0),
    provider: 'TRANSBANK',
    providerReference: 'tok',
    status: PaymentAttemptStatus.PENDING,
  } as unknown as PaymentAttempt;
  const approvedOutcome = {
    kind: 'SETTLED',
    result: 'APPROVED',
    providerReference: 'tok',
  };
  const approvedSnapshot = {
    providerReference: 'tok',
    outcome: 'APPROVED',
  } as never;

  const txOrderFindUnique = jest.fn();
  const txMock = {
    order: {
      findUnique: txOrderFindUnique,
      update: jest
        .fn()
        .mockResolvedValue({ id: 'order-1', status: OrderStatus.ROUTED }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    bill: { findUniqueOrThrow: jest.fn().mockResolvedValue({}) },
  };
  const transactionMock = jest.fn();
  const attemptFindFirstMock = jest.fn();
  const prisma = {
    paymentAttempt: { findFirst: attemptFindFirstMock },
    bill: {
      findUnique: jest.fn().mockResolvedValue({
        branch: { restaurantId: 'r-1', restaurant: { currency: 'CLP' } },
      }),
    },
    $transaction: transactionMock,
  } as unknown as PrismaService;
  const confirmRedirectMock = jest.fn();
  const getPaymentMock = jest.fn();
  const gateway = {
    providerName: 'TRANSBANK',
    checkoutMode: 'redirect',
    confirmRedirect: confirmRedirectMock,
    getPayment: getPaymentMock,
  } as unknown as PaymentGatewayPort;
  const registry = {
    get: jest.fn().mockReturnValue(gateway),
    getAll: jest.fn().mockReturnValue([gateway]),
  } as unknown as PaymentGatewayRegistry;
  const resolver: PaymentGatewayResolverPort = {
    resolveAvailable: jest.fn().mockResolvedValue([]),
  };
  const finalizeMock = jest.fn();
  const failMock = jest.fn();
  const emitMock = jest.fn();
  let service: ConfirmRedirectPaymentService;

  const payableOrder = {
    id: 'order-1',
    branchId: 'branch-1',
    status: OrderStatus.AWAITING_PAYMENT,
    orderItems: [],
  };

  beforeEach(() => {
    jest.clearAllMocks();
    txOrderFindUnique.mockResolvedValue(payableOrder);
    finalizeMock.mockResolvedValue({ id: 'payment-1' });
    transactionMock.mockImplementation(
      (cb: (tx: unknown) => Promise<unknown>) => cb(txMock),
    );
    service = new ConfirmRedirectPaymentService(
      prisma,
      registry,
      resolver,
      { execute: finalizeMock } as unknown as FinalizePaymentService,
      { execute: failMock },
      { emit: emitMock } as unknown as EventEmitter2,
    );
  });

  it('emits once after commit when a Transbank return routes the order', async () => {
    confirmRedirectMock.mockResolvedValue(approvedOutcome);
    attemptFindFirstMock.mockResolvedValue(attempt);

    await service.execute({ tokenWs: 'tok' });

    expect(emitMock).toHaveBeenCalledTimes(1);
    expect(emitMock).toHaveBeenCalledWith(ORDER_CREATED_EVENT, {
      orderId: 'order-1',
      branchId: 'branch-1',
    });
  });

  it('emits once for the webhook settle path (applySnapshotOutcome)', async () => {
    await service.applySnapshotOutcome(attempt, approvedSnapshot);

    expect(emitMock).toHaveBeenCalledTimes(1);
  });

  it('emits once for the reconcile path', async () => {
    getPaymentMock.mockResolvedValue({
      providerReference: 'tok',
      outcome: 'APPROVED',
    });

    await service.reconcilePendingAttempt(attempt);

    expect(emitMock).toHaveBeenCalledTimes(1);
  });

  it('emits after the transaction has committed, not inside it', async () => {
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

    await service.applySnapshotOutcome(attempt, approvedSnapshot);

    expect(events).toEqual(['commit', 'emit']);
    expect(emitMock).toHaveBeenCalledTimes(1);
  });

  it('does not emit when the order no longer admits routing (manual review)', async () => {
    txOrderFindUnique.mockResolvedValue({
      ...payableOrder,
      status: OrderStatus.ROUTED,
    });

    await service.applySnapshotOutcome(attempt, approvedSnapshot);

    expect(emitMock).not.toHaveBeenCalled();
  });

  it('emits only once when the same confirmation is processed twice', async () => {
    txOrderFindUnique
      .mockResolvedValueOnce(payableOrder)
      .mockResolvedValueOnce({ ...payableOrder, status: OrderStatus.ROUTED });

    await service.applySnapshotOutcome(attempt, approvedSnapshot);
    await service.applySnapshotOutcome(attempt, approvedSnapshot);

    expect(emitMock).toHaveBeenCalledTimes(1);
  });

  it('does not emit when the payment is rejected', async () => {
    await service.applySnapshotOutcome(attempt, {
      providerReference: 'tok',
      outcome: 'REJECTED',
    } as never);

    expect(emitMock).not.toHaveBeenCalled();
  });

  it('does not emit when the transaction throws', async () => {
    finalizeMock.mockRejectedValue(new Error('boom'));

    await expect(
      service.applySnapshotOutcome(attempt, approvedSnapshot),
    ).rejects.toThrow('boom');

    expect(emitMock).not.toHaveBeenCalled();
  });

  it('does not break the confirmation when the emitter throws', async () => {
    emitMock.mockImplementation(() => {
      throw new Error('listener down');
    });

    const result = await service.applySnapshotOutcome(
      attempt,
      approvedSnapshot,
    );

    expect(result.kind).toBe('APPROVED');
  });
});

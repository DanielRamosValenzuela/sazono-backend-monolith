import { Prisma, RefundMethod, RefundStatus } from '@prisma/client';
import type { AuditService } from '../../../common/audit/audit.service';
import { enqueueCreditNoteForRefund } from '../../billing/application/create-pending-credit-note.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { PaymentGatewayResolverPort } from './ports/payment-gateway-resolver.port';
import type {
  GatewayRefundOutcome,
  GatewayRefundState,
} from './ports/payment-gateway.port';
import {
  RefundGatewayService,
  type GatewayRefundRecord,
} from './refund-gateway.service';

const d = (value: number | string) => new Prisma.Decimal(value);

function build(
  options: {
    outcome?: GatewayRefundOutcome | Error;
    state?: GatewayRefundState;
    connected?: boolean;
    refund?: Partial<GatewayRefundRecord>;
    updateCount?: number;
  } = {},
) {
  const refund = {
    id: 'refund-1',
    restaurantId: 'restaurant-1',
    branchId: 'branch-1',
    billId: 'bill-1',
    paymentId: 'payment-1',
    amount: d(3000),
    tipAmount: d(500),
    status: RefundStatus.PENDING,
    method: RefundMethod.GATEWAY,
    providerRaw: null,
    providerRefundReference: null,
    failureReason: null,
    createdAt: new Date(),
    payment: {
      provider: 'MERCADO_PAGO',
      providerReference: 'ORD1',
      gatewayMeta: { transactionId: 'PAY1' },
      amount: d(11000),
    },
    restaurant: { currency: 'CLP' },
    ...options.refund,
  } as unknown as GatewayRefundRecord;

  const gateway = {
    providerName: 'MERCADO_PAGO',
    refund: jest.fn(() =>
      options.outcome instanceof Error
        ? Promise.reject(options.outcome)
        : Promise.resolve(options.outcome ?? { kind: 'AMBIGUOUS' }),
    ),
    getRefundState: jest.fn(() =>
      Promise.resolve(options.state ?? ({ kind: 'UNKNOWN' } as const)),
    ),
  };
  const resolveAvailable = jest.fn(() =>
    Promise.resolve(
      options.connected === false
        ? []
        : [
            {
              provider: 'MERCADO_PAGO',
              gateway,
              credentials: { accessToken: 'tok' },
            },
          ],
    ),
  );
  const tx = {
    refund: {
      updateMany: jest.fn(() =>
        Promise.resolve({ count: options.updateCount ?? 1 }),
      ),
    },
    bill: { update: jest.fn().mockResolvedValue({}) },
    $queryRaw: jest.fn().mockResolvedValue([{ id: 'payment-1' }]),
  };
  const audits: Array<Record<string, unknown>> = [];
  const prisma = {
    refund: {
      findUnique: jest.fn(() => Promise.resolve(refund)),
      aggregate: jest.fn().mockResolvedValue({ _sum: { amount: d(1000) } }),
      updateMany: tx.refund.updateMany,
    },
    $transaction: jest.fn((cb: (client: typeof tx) => Promise<unknown>) =>
      cb(tx),
    ),
  };
  const audit = {
    record: jest.fn((_client: unknown, input: Record<string, unknown>) => {
      audits.push(input);
      return Promise.resolve();
    }),
  };
  const service = new RefundGatewayService(
    prisma as unknown as PrismaService,
    audit as unknown as AuditService,
    { resolveAvailable } as unknown as PaymentGatewayResolverPort,
  );

  return { service, refund, gateway, tx, prisma, audits };
}

const limits = { maxAttempts: 10, maxAgeMs: 48 * 3600 * 1000 };
const updateData = (ctx: ReturnType<typeof build>, call = 0) =>
  (
    ctx.tx.refund.updateMany.mock.calls[call] as unknown as [
      { data: Record<string, unknown> },
    ]
  )[0].data;

jest.mock('../../billing/application/create-pending-credit-note.service');

describe('RefundGatewayService', () => {
  beforeEach(() => {
    jest.mocked(enqueueCreditNoteForRefund).mockClear();
  });

  describe('dispatch', () => {
    it('calls the gateway with the refund id as idempotency key and the prior refunded amount', async () => {
      const ctx = build({
        outcome: { kind: 'REFUNDED', providerRefundReference: 'REF1' },
      });

      await ctx.service.dispatch('refund-1');

      expect(ctx.gateway.refund).toHaveBeenCalledWith(
        expect.objectContaining({
          idempotencyKey: 'refund-1',
          providerReference: 'ORD1',
          paymentAmount: d(11000),
          alreadyRefundedAmount: d(1000),
          currency: 'CLP',
        }),
      );
    });

    it('counts only gateway refunds as already refunded', async () => {
      const ctx = build({ outcome: { kind: 'AMBIGUOUS' } });

      await ctx.service.dispatch('refund-1');

      expect(ctx.prisma.refund.aggregate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            method: RefundMethod.GATEWAY,
            status: RefundStatus.SUCCEEDED,
          }),
        }),
      );
    });

    it('marks SUCCEEDED with the provider reference and audits REFUND_SUCCEEDED', async () => {
      const ctx = build({
        outcome: { kind: 'REFUNDED', providerRefundReference: 'REF1' },
      });

      await ctx.service.dispatch('refund-1');

      expect(updateData(ctx)).toMatchObject({
        status: RefundStatus.SUCCEEDED,
        providerRefundReference: 'REF1',
        failureReason: null,
      });
      expect(updateData(ctx).completedAt).toBeInstanceOf(Date);
      expect(ctx.audits.map((item) => item.action)).toEqual([
        'REFUND_SUCCEEDED',
      ]);
      expect(ctx.tx.$queryRaw).not.toHaveBeenCalled();
      expect(enqueueCreditNoteForRefund).toHaveBeenCalledWith(
        ctx.tx,
        'refund-1',
      );
    });

    it('marks FAILED, releases the reservation and audits when the gateway rejects', async () => {
      const ctx = build({
        outcome: {
          kind: 'REJECTED',
          retryable: false,
          failureReason: 'Sin saldo',
          code: 'HTTP_400',
        },
      });

      await ctx.service.dispatch('refund-1');

      expect(updateData(ctx)).toMatchObject({
        status: RefundStatus.FAILED,
        failureReason: 'Sin saldo',
      });
      expect(ctx.tx.$queryRaw).toHaveBeenCalledTimes(1);
      expect(ctx.tx.bill.update).toHaveBeenCalledWith({
        where: { id: 'bill-1' },
        data: { refundedAmount: { decrement: d(3000) } },
      });
      expect(ctx.audits.map((item) => item.action)).toEqual(['REFUND_FAILED']);
    });

    it('keeps the refund PENDING and the reservation when the outcome is ambiguous', async () => {
      const ctx = build({ outcome: { kind: 'AMBIGUOUS' } });

      await ctx.service.dispatch('refund-1');

      expect(ctx.tx.$queryRaw).not.toHaveBeenCalled();
      expect(updateData(ctx)).not.toHaveProperty('status');
      expect(ctx.audits).toHaveLength(0);
    });

    it('treats an adapter exception as ambiguous', async () => {
      const ctx = build({ outcome: new Error('socket') });

      await ctx.service.dispatch('refund-1');

      expect(updateData(ctx)).not.toHaveProperty('status');
      expect(ctx.tx.$queryRaw).not.toHaveBeenCalled();
    });

    it('fails with a manual suggestion when the restaurant account is not connected', async () => {
      const ctx = build({ connected: false });

      await ctx.service.dispatch('refund-1');

      expect(ctx.gateway.refund).not.toHaveBeenCalled();
      expect(updateData(ctx)).toMatchObject({ status: RefundStatus.FAILED });
      expect(String(updateData(ctx).failureReason)).toContain('manual');
    });

    it('does nothing when the refund is not PENDING anymore', async () => {
      const ctx = build({ refund: { status: RefundStatus.SUCCEEDED } });

      await ctx.service.dispatch('refund-1');

      expect(ctx.gateway.refund).not.toHaveBeenCalled();
    });

    it('does not release the reservation twice when another process already settled it', async () => {
      const ctx = build({
        outcome: {
          kind: 'REJECTED',
          retryable: false,
          failureReason: 'x',
        },
        updateCount: 0,
      });

      await ctx.service.dispatch('refund-1');

      expect(ctx.tx.$queryRaw).not.toHaveBeenCalled();
      expect(ctx.audits).toHaveLength(0);
    });
  });

  describe('reconcile', () => {
    it('settles a refund the gateway reports as refunded', async () => {
      const ctx = build({
        state: { kind: 'REFUNDED', providerRefundReference: 'REF9' },
      });

      expect(await ctx.service.reconcile(ctx.refund, limits)).toBe('SUCCEEDED');
      expect(updateData(ctx)).toMatchObject({
        status: RefundStatus.SUCCEEDED,
        providerRefundReference: 'REF9',
      });
    });

    it('fails and releases the reservation when the gateway has no trace of the refund', async () => {
      const ctx = build({ state: { kind: 'NOT_REFUNDED' } });

      expect(await ctx.service.reconcile(ctx.refund, limits)).toBe('FAILED');
      expect(ctx.tx.$queryRaw).toHaveBeenCalledTimes(1);
    });

    it('counts the attempt and stays PENDING while the state is unknown', async () => {
      const ctx = build({ state: { kind: 'UNKNOWN' } });

      expect(await ctx.service.reconcile(ctx.refund, limits)).toBe('PENDING');
      expect(updateData(ctx).providerRaw).toMatchObject({
        reconcileAttempts: 1,
      });
    });

    it('escalates to REQUIRES_MANUAL_REVIEW keeping the reservation after too many attempts', async () => {
      const ctx = build({
        state: { kind: 'PENDING' },
        refund: { providerRaw: { reconcileAttempts: 9 } },
      });

      expect(await ctx.service.reconcile(ctx.refund, limits)).toBe(
        'REQUIRES_MANUAL_REVIEW',
      );
      expect(updateData(ctx)).toMatchObject({
        status: RefundStatus.REQUIRES_MANUAL_REVIEW,
      });
      expect(ctx.tx.$queryRaw).not.toHaveBeenCalled();
      expect(ctx.audits.map((item) => item.action)).toEqual([
        'REFUND_REQUIRES_MANUAL_REVIEW',
      ]);
    });

    it('escalates after 48 hours', async () => {
      const ctx = build({
        state: { kind: 'PENDING' },
        refund: { createdAt: new Date(Date.now() - 49 * 3600 * 1000) },
      });

      expect(await ctx.service.reconcile(ctx.refund, limits)).toBe(
        'REQUIRES_MANUAL_REVIEW',
      );
    });
  });
});

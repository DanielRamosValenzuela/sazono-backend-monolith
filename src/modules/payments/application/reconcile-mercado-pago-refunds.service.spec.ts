import { Prisma, RefundStatus } from '@prisma/client';
import type { AuditService } from '../../../common/audit/audit.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { GatewayPaymentSnapshot } from './ports/payment-gateway.port';
import type { RefundGatewayService } from './refund-gateway.service';
import {
  EXTERNAL_REFUND_REASON_TEXT,
  ReconcileMercadoPagoRefundsService,
} from './reconcile-mercado-pago-refunds.service';

const d = (value: number | string) => new Prisma.Decimal(value);

function build(
  options: {
    payment?: Record<string, unknown> | null;
    known?: Record<string, unknown> | null;
    own?: Record<string, unknown> | null;
    manual?: Record<string, unknown> | null;
    bindCount?: number;
    guardRows?: number;
    duplicate?: boolean;
  } = {},
) {
  const payment =
    options.payment === null
      ? null
      : {
          id: 'payment-1',
          billId: 'bill-1',
          providerReference: 'ORD1',
          amount: d(11000),
          tipAmount: d(1000),
          refundedAmount: d(0),
          refundedTipAmount: d(0),
          bill: {
            id: 'bill-1',
            branchId: 'branch-1',
            branch: { restaurantId: 'restaurant-1' },
          },
          ...options.payment,
        };
  const tx = {
    payment: { findUniqueOrThrow: jest.fn().mockResolvedValue(payment) },
    $queryRaw: jest.fn(() =>
      Promise.resolve(
        options.guardRows === 0
          ? []
          : [{ refunded_amount: d(3000), refunded_tip_amount: d(0) }],
      ),
    ),
    refund: {
      create: jest.fn(({ data }: { data: Record<string, unknown> }) => {
        if (options.duplicate) {
          throw new Prisma.PrismaClientKnownRequestError('dup', {
            code: 'P2002',
            clientVersion: 'test',
          });
        }

        return Promise.resolve({ id: 'refund-ext', ...data });
      }),
    },
    bill: { update: jest.fn().mockResolvedValue({}) },
  };
  const findFirst = jest
    .fn()
    .mockResolvedValueOnce(options.known ?? null)
    .mockResolvedValueOnce(options.own ?? null)
    .mockResolvedValueOnce(options.manual ?? null);
  const prisma = {
    payment: {
      findFirst: jest.fn().mockResolvedValue(payment),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    refund: {
      findFirst,
      updateMany: jest
        .fn()
        .mockResolvedValue({ count: options.bindCount ?? 1 }),
    },
    $transaction: jest.fn((cb: (client: typeof tx) => Promise<unknown>) =>
      cb(tx),
    ),
  };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const gateway = {
    markSucceeded: jest.fn().mockResolvedValue(undefined),
    audit: jest.fn().mockResolvedValue(undefined),
  };
  const service = new ReconcileMercadoPagoRefundsService(
    prisma as unknown as PrismaService,
    audit as unknown as AuditService,
    gateway as unknown as RefundGatewayService,
  );

  return { service, prisma, tx, audit, gateway, findFirst };
}

const snapshot = (
  overrides: Partial<GatewayPaymentSnapshot> = {},
): GatewayPaymentSnapshot => ({
  providerReference: 'ORD1',
  outcome: 'PENDING',
  rawStatus: 'refunded',
  refunds: [{ reference: 'REF1', amount: '3000', outcome: 'APPROVED' }],
  ...overrides,
});

describe('ReconcileMercadoPagoRefundsService', () => {
  it('ignores snapshots without refunds or chargebacks', async () => {
    const ctx = build();

    await ctx.service.execute(
      snapshot({ rawStatus: 'processed', refunds: [] }),
    );

    expect(ctx.prisma.payment.findFirst).not.toHaveBeenCalled();
  });

  it('does nothing when the payment is unknown', async () => {
    const ctx = build({ payment: null });

    await ctx.service.execute(snapshot());

    expect(ctx.prisma.$transaction).not.toHaveBeenCalled();
  });

  it('conciliates our own pending refund by amount instead of creating a new one', async () => {
    const own = { id: 'refund-own', status: RefundStatus.PENDING };
    const ctx = build({ own });

    await ctx.service.execute(snapshot());

    expect(ctx.gateway.markSucceeded).toHaveBeenCalledWith(
      own,
      expect.objectContaining({
        kind: 'REFUNDED',
        providerRefundReference: 'REF1',
      }),
      expect.anything(),
    );
    expect(ctx.tx.refund.create).not.toHaveBeenCalled();
  });

  it('only matches our pending refund once it is older than the dispatch window', async () => {
    const ctx = build();

    await ctx.service.execute(snapshot());

    const where = (
      ctx.findFirst.mock.calls[1] as [{ where: Record<string, unknown> }]
    )[0].where;
    expect(where.createdAt).toEqual({ lt: expect.any(Date) });
  });

  it('binds the reference to an unreferenced manual refund instead of double booking', async () => {
    const manual = { id: 'refund-manual' };
    const ctx = build({ manual });

    await ctx.service.execute(snapshot());

    expect(ctx.prisma.refund.updateMany).toHaveBeenCalledWith({
      where: { id: 'refund-manual', providerRefundReference: null },
      data: { provider: 'MERCADO_PAGO', providerRefundReference: 'REF1' },
    });
    expect(ctx.tx.refund.create).not.toHaveBeenCalled();
    expect(ctx.tx.bill.update).not.toHaveBeenCalled();
    expect(ctx.audit.record).toHaveBeenCalledWith(
      null,
      expect.objectContaining({ action: 'REFUND_EXTERNAL_BOUND' }),
    );
  });

  it('creates the external refund when the manual one was bound concurrently', async () => {
    const ctx = build({ manual: { id: 'refund-manual' }, bindCount: 0 });

    await ctx.service.execute(snapshot());

    expect(ctx.tx.refund.create).toHaveBeenCalledTimes(1);
  });

  it('conciliates by provider reference when we already stored it', async () => {
    const known = { id: 'refund-own', status: RefundStatus.PENDING };
    const ctx = build({ known });

    await ctx.service.execute(snapshot());

    expect(ctx.gateway.markSucceeded).toHaveBeenCalledTimes(1);
    expect(ctx.tx.refund.create).not.toHaveBeenCalled();
  });

  it('skips a refund already SUCCEEDED locally (duplicate webhook)', async () => {
    const ctx = build({
      known: { id: 'refund-own', status: RefundStatus.SUCCEEDED },
    });

    await ctx.service.execute(snapshot());

    expect(ctx.gateway.markSucceeded).not.toHaveBeenCalled();
    expect(ctx.tx.refund.create).not.toHaveBeenCalled();
  });

  it('creates a WEBHOOK refund for a refund made from the Mercado Pago panel', async () => {
    const ctx = build();

    await ctx.service.execute(snapshot());

    expect(ctx.tx.refund.create).toHaveBeenCalledTimes(1);
    const data = (
      ctx.tx.refund.create.mock.calls[0] as [{ data: Record<string, unknown> }]
    )[0].data;
    expect(data).toMatchObject({
      source: 'WEBHOOK',
      method: 'GATEWAY',
      status: RefundStatus.SUCCEEDED,
      reasonCode: 'OTHER',
      reasonText: EXTERNAL_REFUND_REASON_TEXT,
      providerRefundReference: 'REF1',
      provider: 'MERCADO_PAGO',
      tipAmount: d(0),
    });
    expect(ctx.tx.bill.update).toHaveBeenCalledWith({
      where: { id: 'bill-1' },
      data: { refundedAmount: { increment: d(3000) } },
    });
    expect(ctx.gateway.audit).toHaveBeenCalledWith(
      ctx.tx,
      expect.anything(),
      expect.anything(),
      'REFUND_SUCCEEDED',
      expect.objectContaining({ source: 'WEBHOOK' }),
      EXTERNAL_REFUND_REASON_TEXT,
    );
  });

  it('assigns the tip share when the external refund exceeds the consumption left', async () => {
    const ctx = build({
      payment: { refundedAmount: d(0) },
    });

    await ctx.service.execute(
      snapshot({
        refunds: [{ reference: 'REF2', amount: '11000', outcome: 'APPROVED' }],
      }),
    );

    const data = (
      ctx.tx.refund.create.mock.calls[0] as [{ data: Record<string, unknown> }]
    )[0].data;
    expect(data.tipAmount).toEqual(d(1000));
  });

  it('treats a unique violation as a duplicate and never double counts', async () => {
    const ctx = build({ duplicate: true });

    await ctx.service.execute(snapshot());

    expect(ctx.audit.record).not.toHaveBeenCalled();
  });

  it('logs and audits instead of creating a refund that would exceed the payment', async () => {
    const ctx = build({ guardRows: 0 });

    await ctx.service.execute(snapshot());

    expect(ctx.tx.refund.create).not.toHaveBeenCalled();
    expect(ctx.audit.record).toHaveBeenCalledWith(
      null,
      expect.objectContaining({ action: 'REFUND_EXTERNAL_SKIPPED' }),
    );
  });

  it('processes several refunds in any order, each one once', async () => {
    const ctx = build();
    ctx.findFirst.mockReset();
    ctx.findFirst.mockResolvedValue(null);

    await ctx.service.execute(
      snapshot({
        refunds: [
          { reference: 'REF-B', amount: '2000', outcome: 'APPROVED' },
          { reference: 'REF-A', amount: '1000', outcome: 'APPROVED' },
          { reference: 'REF-C', amount: '500', outcome: 'PENDING' },
        ],
      }),
    );

    const references = ctx.tx.refund.create.mock.calls.map(
      (call) =>
        (call as [{ data: { providerRefundReference: string } }])[0].data
          .providerRefundReference,
    );
    expect(references).toEqual(['REF-B', 'REF-A']);
  });

  it('flags a chargeback as disputed without creating a refund', async () => {
    const ctx = build();

    await ctx.service.execute(
      snapshot({ rawStatus: 'charged_back', refunds: [], chargedBack: true }),
    );

    expect(ctx.prisma.payment.updateMany).toHaveBeenCalledWith({
      where: { id: 'payment-1', disputed: false },
      data: { disputed: true },
    });
    expect(ctx.audit.record).toHaveBeenCalledWith(
      null,
      expect.objectContaining({ action: 'PAYMENT_DISPUTED' }),
    );
    expect(ctx.tx.refund.create).not.toHaveBeenCalled();
  });

  it('does not audit a second time when the payment is already disputed', async () => {
    const ctx = build();
    ctx.prisma.payment.updateMany.mockResolvedValue({ count: 0 });

    await ctx.service.execute(
      snapshot({ rawStatus: 'charged_back', refunds: [], chargedBack: true }),
    );

    expect(ctx.audit.record).not.toHaveBeenCalled();
  });
});

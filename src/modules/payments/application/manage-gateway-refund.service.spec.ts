import { ConflictException } from '@nestjs/common';
import { RefundMethod, RefundStatus, Role } from '@prisma/client';
import type { BranchAccessService } from '../../../common/branch-access/branch-access.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { JwtPayload } from '../../auth/interfaces/jwt-payload.interface';
import { ManageGatewayRefundService } from './manage-gateway-refund.service';
import type {
  GatewayRefundRecord,
  RefundGatewayService,
} from './refund-gateway.service';

const authUser = { sub: 'auth-1' } as unknown as JwtPayload;
const meta = { ip: null, userAgent: null };

function build(
  refund: Partial<GatewayRefundRecord>,
  options: { reserved?: boolean } = {},
) {
  const record = {
    id: 'refund-1',
    branchId: 'branch-1',
    method: RefundMethod.GATEWAY,
    status: RefundStatus.FAILED,
    providerRaw: null,
    reasonText: 'Plato frio',
    createdAt: new Date(Date.now() - 10 * 60 * 1000),
    payment: { provider: 'MERCADO_PAGO' },
    ...refund,
  } as unknown as GatewayRefundRecord;
  const tx = {
    refund: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
  };
  const refundGateway = {
    load: jest.fn().mockResolvedValue(record),
    reserve: jest.fn().mockResolvedValue(options.reserved ?? true),
    dispatch: jest.fn().mockResolvedValue(record),
    reconcile: jest.fn().mockResolvedValue('PENDING'),
    audit: jest.fn().mockResolvedValue(undefined),
    toResult: jest.fn().mockResolvedValue({ ok: true }),
  };
  const ensureAccess = jest.fn().mockResolvedValue({ staffUserId: 'staff-1' });
  const service = new ManageGatewayRefundService(
    {
      $transaction: jest.fn((cb: (client: typeof tx) => Promise<unknown>) =>
        cb(tx),
      ),
    } as unknown as PrismaService,
    { ensureAccess } as unknown as BranchAccessService,
    refundGateway as unknown as RefundGatewayService,
  );

  return { service, tx, refundGateway, ensureAccess };
}

describe('ManageGatewayRefundService', () => {
  it('requires an ADMIN with fresh roles on the refund branch', async () => {
    const ctx = build({});

    await ctx.service.retry(authUser, 'refund-1', meta);

    expect(ctx.ensureAccess).toHaveBeenCalledWith(
      authUser,
      'branch-1',
      [Role.ADMIN],
      { fresh: true },
    );
  });

  it('retries a FAILED refund: re-reserves, reopens as PENDING, audits and dispatches', async () => {
    const ctx = build({});

    await ctx.service.retry(authUser, 'refund-1', meta);

    expect(ctx.refundGateway.reserve).toHaveBeenCalledTimes(1);
    expect(ctx.tx.refund.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'refund-1', status: RefundStatus.FAILED },
        data: expect.objectContaining({ status: RefundStatus.PENDING }),
      }),
    );
    expect(ctx.refundGateway.audit).toHaveBeenCalledWith(
      ctx.tx,
      expect.anything(),
      expect.anything(),
      'REFUND_RETRIED',
      { retries: 1 },
    );
    expect(ctx.refundGateway.dispatch).toHaveBeenCalledTimes(1);
  });

  it('answers 409 when the balance is no longer available on retry', async () => {
    const ctx = build({}, { reserved: false });

    await expect(
      ctx.service.retry(authUser, 'refund-1', meta),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(ctx.refundGateway.dispatch).not.toHaveBeenCalled();
  });

  it('refuses to retry a young PENDING refund', async () => {
    const ctx = build({
      status: RefundStatus.PENDING,
      createdAt: new Date(),
    });

    await expect(
      ctx.service.retry(authUser, 'refund-1', meta),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('checks the gateway before retrying a stale PENDING refund and does not resend when still unknown', async () => {
    const ctx = build({ status: RefundStatus.PENDING });

    await expect(
      ctx.service.retry(authUser, 'refund-1', meta),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(ctx.refundGateway.reconcile).toHaveBeenCalledTimes(1);
    expect(ctx.refundGateway.dispatch).not.toHaveBeenCalled();
  });

  it('refuses refunds that are not gateway refunds', async () => {
    const ctx = build({ method: RefundMethod.CASH_MANUAL });

    await expect(
      ctx.service.markManual(authUser, 'refund-1', meta),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('marks a FAILED refund as manual external, re-reserving and auditing', async () => {
    const ctx = build({});

    await ctx.service.markManual(authUser, 'refund-1', meta);

    expect(ctx.refundGateway.reserve).toHaveBeenCalledTimes(1);
    const data = (
      ctx.tx.refund.updateMany.mock.calls[0] as unknown as [
        { data: Record<string, unknown> },
      ]
    )[0].data;
    expect(data).toMatchObject({
      status: RefundStatus.SUCCEEDED,
      method: RefundMethod.MANUAL_EXTERNAL,
    });
    expect(ctx.refundGateway.audit).toHaveBeenCalledWith(
      ctx.tx,
      expect.anything(),
      expect.anything(),
      'REFUND_REGISTERED_MANUAL',
      expect.objectContaining({ previousStatus: RefundStatus.FAILED }),
      'Plato frio',
    );
  });

  it('keeps the existing reservation when marking a review refund as manual', async () => {
    const ctx = build({ status: RefundStatus.REQUIRES_MANUAL_REVIEW });

    await ctx.service.markManual(authUser, 'refund-1', meta);

    expect(ctx.refundGateway.reserve).not.toHaveBeenCalled();
  });

  it('does not touch a SUCCEEDED refund', async () => {
    const ctx = build({ status: RefundStatus.SUCCEEDED });

    await expect(
      ctx.service.markManual(authUser, 'refund-1', meta),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

import type { PrismaService } from '../../../common/prisma/prisma.service';
import { ReconcileGatewayRefundsService } from './reconcile-gateway-refunds.service';
import type { RefundGatewayService } from './refund-gateway.service';

describe('ReconcileGatewayRefundsService', () => {
  const params = { minAgeMinutes: 2, maxAttempts: 10, maxAgeHours: 48 };

  function build(results: Array<string | Error>) {
    const refunds = results.map((_, index) => ({ id: `refund-${index}` }));
    const findMany = jest.fn().mockResolvedValue(refunds);
    const reconcile = jest.fn();

    for (const result of results) {
      if (result instanceof Error) {
        reconcile.mockRejectedValueOnce(result);
      } else {
        reconcile.mockResolvedValueOnce(result);
      }
    }

    const service = new ReconcileGatewayRefundsService(
      { refund: { findMany } } as unknown as PrismaService,
      { reconcile } as unknown as RefundGatewayService,
    );

    return { service, findMany, reconcile };
  }

  it('asks only for old PENDING GATEWAY refunds in a bounded batch', async () => {
    const ctx = build([]);

    await ctx.service.execute(params);

    const args = ctx.findMany.mock.calls[0] as [
      {
        where: { method: string; status: string; createdAt: { lte: Date } };
        take: number;
      },
    ];
    expect(args[0].where).toMatchObject({
      method: 'GATEWAY',
      status: 'PENDING',
    });
    expect(args[0].where.createdAt.lte.getTime()).toBeLessThanOrEqual(
      Date.now() - 2 * 60 * 1000 + 1000,
    );
    expect(args[0].take).toBe(100);
  });

  it('summarizes every outcome and survives a failing refund', async () => {
    const ctx = build([
      'SUCCEEDED',
      'FAILED',
      'PENDING',
      'REQUIRES_MANUAL_REVIEW',
      new Error('boom'),
    ]);

    const summary = await ctx.service.execute(params);

    expect(summary).toEqual({
      scanned: 5,
      succeeded: 1,
      failed: 1,
      stillPending: 2,
      requiresReview: 1,
    });
    expect(ctx.reconcile).toHaveBeenCalledWith(expect.anything(), {
      maxAttempts: 10,
      maxAgeMs: 48 * 3600 * 1000,
    });
  });
});

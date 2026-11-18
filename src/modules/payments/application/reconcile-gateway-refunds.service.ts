import { Injectable, Logger } from '@nestjs/common';
import { RefundMethod, RefundStatus } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import {
  GATEWAY_REFUND_INCLUDE,
  RefundGatewayService,
} from './refund-gateway.service';

export type ReconcileGatewayRefundsParams = {
  minAgeMinutes: number;
  maxAttempts: number;
  maxAgeHours: number;
};

export type ReconcileGatewayRefundsSummary = {
  scanned: number;
  succeeded: number;
  failed: number;
  stillPending: number;
  requiresReview: number;
};

const MAX_REFUNDS_PER_RUN = 100;

@Injectable()
export class ReconcileGatewayRefundsService {
  private readonly logger = new Logger(ReconcileGatewayRefundsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly refundGateway: RefundGatewayService,
  ) {}

  async execute(
    params: ReconcileGatewayRefundsParams,
  ): Promise<ReconcileGatewayRefundsSummary> {
    const cutoff = new Date(Date.now() - params.minAgeMinutes * 60 * 1000);
    const refunds = await this.prisma.refund.findMany({
      where: {
        method: RefundMethod.GATEWAY,
        status: RefundStatus.PENDING,
        createdAt: { lte: cutoff },
      },
      include: GATEWAY_REFUND_INCLUDE,
      orderBy: { createdAt: 'asc' },
      take: MAX_REFUNDS_PER_RUN,
    });
    const summary: ReconcileGatewayRefundsSummary = {
      scanned: refunds.length,
      succeeded: 0,
      failed: 0,
      stillPending: 0,
      requiresReview: 0,
    };

    for (const refund of refunds) {
      try {
        const result = await this.refundGateway.reconcile(refund, {
          maxAttempts: params.maxAttempts,
          maxAgeMs: params.maxAgeHours * 60 * 60 * 1000,
        });

        if (result === 'SUCCEEDED') {
          summary.succeeded += 1;
        } else if (result === 'FAILED') {
          summary.failed += 1;
        } else if (result === 'REQUIRES_MANUAL_REVIEW') {
          summary.requiresReview += 1;
        } else {
          summary.stillPending += 1;
        }
      } catch (error) {
        summary.stillPending += 1;
        this.logger.error(
          `Fallo al conciliar el reembolso ${refund.id}: ${
            error instanceof Error ? error.message : 'error desconocido'
          }`,
        );
      }
    }

    if (summary.scanned > 0) {
      this.logger.log(
        `Conciliacion de reembolsos: ${summary.scanned} revisados, ${summary.succeeded} exitosos, ${summary.failed} fallidos, ${summary.stillPending} pendientes, ${summary.requiresReview} a revision manual.`,
      );
    }

    return summary;
  }
}

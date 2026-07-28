import { ConflictException, Injectable, Logger } from '@nestjs/common';
import type { PaymentAttempt } from '@prisma/client';
import { PaymentAttemptStatus } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { assertNever } from '../domain/assert-never';
import { TRANSBANK_PROVIDER_NAME } from '../domain/transbank-status';
import { ConfirmRedirectPaymentService } from './confirm-redirect-payment.service';

export type ReconcileTransbankPaymentsSummary = {
  scanned: number;
  approved: number;
  rejected: number;
  stillPending: number;
  resolvedConcurrently: number;
};

const MAX_ATTEMPTS_PER_RUN = 200;

@Injectable()
export class ReconcileTransbankPaymentsService {
  private readonly logger = new Logger(ReconcileTransbankPaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly confirmRedirectPaymentService: ConfirmRedirectPaymentService,
  ) {}

  async execute(
    minAgeMinutes: number,
  ): Promise<ReconcileTransbankPaymentsSummary> {
    const cutoff = new Date(Date.now() - minAgeMinutes * 60 * 1000);
    const attempts = await this.findEligibleAttempts(cutoff);
    const summary: ReconcileTransbankPaymentsSummary = {
      scanned: attempts.length,
      approved: 0,
      rejected: 0,
      stillPending: 0,
      resolvedConcurrently: 0,
    };

    for (const attempt of attempts) {
      await this.reconcileOne(attempt, summary);
    }

    if (summary.scanned > 0) {
      this.logger.log(
        `Conciliacion Transbank: ${summary.scanned} intentos revisados, ${summary.approved} aprobados, ${summary.rejected} rechazados, ${summary.stillPending} aun pendientes, ${summary.resolvedConcurrently} resueltos por otro proceso mientras corria el job.`,
      );
    }

    return summary;
  }

  private findEligibleAttempts(cutoff: Date): Promise<PaymentAttempt[]> {
    return this.prisma.paymentAttempt.findMany({
      where: {
        provider: TRANSBANK_PROVIDER_NAME,
        status: PaymentAttemptStatus.PENDING,
        providerReference: { not: null },
        createdAt: { lte: cutoff },
      },
      orderBy: { createdAt: 'asc' },
      take: MAX_ATTEMPTS_PER_RUN,
    });
  }

  private async reconcileOne(
    attempt: PaymentAttempt,
    summary: ReconcileTransbankPaymentsSummary,
  ): Promise<void> {
    try {
      const outcome =
        await this.confirmRedirectPaymentService.reconcilePendingAttempt(
          attempt,
        );

      switch (outcome.kind) {
        case 'APPROVED':
          summary.approved += 1;
          return;
        case 'REJECTED':
          summary.rejected += 1;
          this.logger.warn(
            `Intento de pago Transbank ${attempt.id} conciliado como rechazado: ${outcome.failureReason}`,
          );
          return;
        case 'STILL_PENDING':
          summary.stillPending += 1;
          return;
        default:
          assertNever(outcome);
      }
    } catch (error) {
      if (error instanceof ConflictException) {
        summary.resolvedConcurrently += 1;
        return;
      }

      this.logger.error(
        `Fallo al conciliar el intento de pago Transbank ${attempt.id}: ${
          error instanceof Error ? error.message : 'error desconocido'
        }`,
      );
    }
  }
}

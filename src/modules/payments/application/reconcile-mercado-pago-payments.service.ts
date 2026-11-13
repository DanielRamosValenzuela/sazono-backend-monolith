import { ConflictException, Injectable, Logger } from '@nestjs/common';
import type { PaymentAttempt } from '@prisma/client';
import { PaymentAttemptStatus } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { assertNever } from '../domain/assert-never';
import { MERCADOPAGO_PROVIDER_NAME } from '../domain/mercado-pago-status';
import { MercadoPagoConfigService } from '../infrastructure/mercado-pago/mercado-pago-config.service';
import { ConfirmRedirectPaymentService } from './confirm-redirect-payment.service';

export type ReconcileMercadoPagoPaymentsSummary = {
  scanned: number;
  approved: number;
  rejected: number;
  stillPending: number;
  resolvedConcurrently: number;
};

const MAX_ATTEMPTS_PER_RUN = 200;
const MAX_PENDING_AGE_MS = 48 * 60 * 60 * 1000;
const NO_REFERENCE_GRACE_MS = 2 * 60 * 60 * 1000;
const EXPIRED_IN_REVIEW_FAILURE_REASON =
  'El pago permanecio en revision con Mercado Pago demasiado tiempo y se marco como fallido. Si el cobro aparece en Mercado Pago, requiere conciliacion manual.';

@Injectable()
export class ReconcileMercadoPagoPaymentsService {
  private readonly logger = new Logger(
    ReconcileMercadoPagoPaymentsService.name,
  );

  constructor(
    private readonly prisma: PrismaService,
    private readonly confirmRedirectPaymentService: ConfirmRedirectPaymentService,
    private readonly mercadoPagoConfig: MercadoPagoConfigService,
  ) {}

  async execute(
    minAgeMinutes: number,
  ): Promise<ReconcileMercadoPagoPaymentsSummary> {
    const summary: ReconcileMercadoPagoPaymentsSummary = {
      scanned: 0,
      approved: 0,
      rejected: 0,
      stillPending: 0,
      resolvedConcurrently: 0,
    };

    if (this.mercadoPagoConfig.apiMode !== 'orders') {
      return summary;
    }

    const cutoff = new Date(Date.now() - minAgeMinutes * 60 * 1000);
    const attempts = await this.findEligibleAttempts(cutoff);
    summary.scanned = attempts.length;

    for (const attempt of attempts) {
      await this.reconcileOne(attempt, summary);
    }

    if (summary.scanned > 0) {
      this.logger.log(
        `Conciliacion Mercado Pago: ${summary.scanned} intentos revisados, ${summary.approved} aprobados, ${summary.rejected} rechazados, ${summary.stillPending} aun pendientes, ${summary.resolvedConcurrently} resueltos por otro proceso mientras corria el job.`,
      );
    }

    return summary;
  }

  private findEligibleAttempts(cutoff: Date): Promise<PaymentAttempt[]> {
    return this.prisma.paymentAttempt.findMany({
      where: {
        provider: MERCADOPAGO_PROVIDER_NAME,
        status: PaymentAttemptStatus.PENDING,
        createdAt: { lte: cutoff },
      },
      orderBy: { createdAt: 'asc' },
      take: MAX_ATTEMPTS_PER_RUN,
    });
  }

  private async reconcileOne(
    attempt: PaymentAttempt,
    summary: ReconcileMercadoPagoPaymentsSummary,
  ): Promise<void> {
    try {
      const age = Date.now() - attempt.createdAt.getTime();
      const expired = age > MAX_PENDING_AGE_MS;
      const rejectWhenMissing =
        expired || (!attempt.providerReference && age > NO_REFERENCE_GRACE_MS);
      const outcome =
        await this.confirmRedirectPaymentService.reconcilePendingAttempt(
          attempt,
          { rejectWhenMissingAtProvider: rejectWhenMissing },
        );

      if (outcome.kind === 'STILL_PENDING' && expired) {
        await this.confirmRedirectPaymentService.rejectUnresolvableAttempt(
          attempt,
          EXPIRED_IN_REVIEW_FAILURE_REASON,
        );
        summary.rejected += 1;
        this.logger.error(
          `Intento de pago Mercado Pago ${attempt.id} sigue en revision tras 48 horas; se marco como fallido. Verificar manualmente en Mercado Pago (order ${attempt.providerReference ?? 'sin referencia'}).`,
        );
        return;
      }

      switch (outcome.kind) {
        case 'APPROVED':
          summary.approved += 1;
          return;
        case 'REJECTED':
          summary.rejected += 1;
          this.logger.warn(
            `Intento de pago Mercado Pago ${attempt.id} conciliado como rechazado: ${outcome.failureReason}`,
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
        `Fallo al conciliar el intento de pago Mercado Pago ${attempt.id}: ${
          error instanceof Error ? error.message : 'error desconocido'
        }`,
      );
    }
  }
}

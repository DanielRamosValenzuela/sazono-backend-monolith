import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, RefundMethod, RefundStatus, Role } from '@prisma/client';
import { BranchAccessService } from '../../../common/branch-access/branch-access.service';
import { enqueueCreditNoteForRefund } from '../../billing/application/create-pending-credit-note.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type { JwtPayload } from '../../auth/interfaces/jwt-payload.interface';
import type { RefundResultResponseDto } from '../presentation/http/dto/refunds.dto';
import {
  RefundGatewayService,
  mergeRaw,
  type GatewayRefundRecord,
  type RefundActor,
} from './refund-gateway.service';
import type { RefundRequestMeta } from './refund-payment.service';

export const STALE_PENDING_REFUND_MS = 2 * 60 * 1000;
const RECONCILE_NOW_LIMITS = {
  maxAttempts: Number.MAX_SAFE_INTEGER,
  maxAgeMs: Number.MAX_SAFE_INTEGER,
};

@Injectable()
export class ManageGatewayRefundService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly branchAccessService: BranchAccessService,
    private readonly refundGateway: RefundGatewayService,
  ) {}

  async retry(
    authUser: JwtPayload,
    refundId: string,
    requestMeta: RefundRequestMeta,
  ): Promise<RefundResultResponseDto> {
    const { refund, actor } = await this.authorize(
      authUser,
      refundId,
      requestMeta,
    );
    const current = await this.settleBeforeChange(refund, actor);

    if (current.status === RefundStatus.SUCCEEDED) {
      return this.refundGateway.toResult(current, true);
    }

    if (current.status !== RefundStatus.FAILED) {
      throw this.notActionable();
    }

    await this.reopen(current, actor);

    const settled = await this.refundGateway.dispatch(current.id, actor);

    return this.refundGateway.toResult(settled ?? current, false);
  }

  async markManual(
    authUser: JwtPayload,
    refundId: string,
    requestMeta: RefundRequestMeta,
  ): Promise<RefundResultResponseDto> {
    const { refund, actor } = await this.authorize(
      authUser,
      refundId,
      requestMeta,
    );

    this.assertActionable(refund);

    await this.prisma.$transaction(async (tx) => {
      if (
        refund.status === RefundStatus.FAILED &&
        !(await this.refundGateway.reserve(tx, refund))
      ) {
        throw this.conflict();
      }

      const result = await tx.refund.updateMany({
        where: {
          id: refund.id,
          status: {
            in: [
              RefundStatus.FAILED,
              RefundStatus.PENDING,
              RefundStatus.REQUIRES_MANUAL_REVIEW,
            ],
          },
        },
        data: {
          status: RefundStatus.SUCCEEDED,
          method: RefundMethod.MANUAL_EXTERNAL,
          completedAt: new Date(),
          failureReason: null,
          providerRaw: mergeRaw(refund.providerRaw, {
            markedManualFrom: refund.status,
          }),
        },
      });

      if (result.count === 0) {
        throw this.conflict();
      }

      await enqueueCreditNoteForRefund(tx, refund.id);

      await this.refundGateway.audit(
        tx,
        refund,
        actor,
        'REFUND_REGISTERED_MANUAL',
        {
          previousStatus: refund.status,
          provider: refund.payment.provider,
          gatewayRefundDoneOutsideSazono: true,
          markedFromGatewayRefund: true,
        },
        refund.reasonText,
      );
    });

    const updated = await this.refundGateway.load(refund.id);

    return this.refundGateway.toResult(updated ?? refund, false);
  }

  private async authorize(
    authUser: JwtPayload,
    refundId: string,
    requestMeta: RefundRequestMeta,
  ): Promise<{ refund: GatewayRefundRecord; actor: RefundActor }> {
    const refund = await this.refundGateway.load(refundId);

    if (!refund) {
      throw new NotFoundException({
        message: 'El reembolso indicado no existe.',
        code: 'REFUND_NOT_FOUND',
      });
    }

    const context = await this.branchAccessService.ensureAccess(
      authUser,
      refund.branchId,
      [Role.ADMIN],
      { fresh: true },
    );

    if (refund.method !== RefundMethod.GATEWAY) {
      throw new ConflictException({
        message: 'Solo se pueden gestionar reembolsos hechos por pasarela.',
        code: 'REFUND_NOT_GATEWAY',
      });
    }

    return {
      refund,
      actor: {
        staffUserId: context.staffUserId,
        role: Role.ADMIN,
        ip: requestMeta.ip,
        userAgent: requestMeta.userAgent,
      },
    };
  }

  private assertActionable(refund: GatewayRefundRecord): void {
    const stalePending =
      refund.status === RefundStatus.PENDING &&
      Date.now() - refund.createdAt.getTime() >= STALE_PENDING_REFUND_MS;

    if (
      refund.status !== RefundStatus.FAILED &&
      refund.status !== RefundStatus.REQUIRES_MANUAL_REVIEW &&
      !stalePending
    ) {
      throw this.notActionable();
    }
  }

  private async settleBeforeChange(
    refund: GatewayRefundRecord,
    actor: RefundActor,
  ): Promise<GatewayRefundRecord> {
    this.assertActionable(refund);

    if (refund.status === RefundStatus.FAILED) {
      return refund;
    }

    await this.refundGateway.reconcile(refund, RECONCILE_NOW_LIMITS, actor);

    return (await this.refundGateway.load(refund.id)) ?? refund;
  }

  private async reopen(
    refund: GatewayRefundRecord,
    actor: RefundActor,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      if (!(await this.refundGateway.reserve(tx, refund))) {
        throw this.conflict();
      }

      const retries = Number(
        (refund.providerRaw as Prisma.JsonObject | null)?.retries ?? 0,
      );
      const result = await tx.refund.updateMany({
        where: { id: refund.id, status: RefundStatus.FAILED },
        data: {
          status: RefundStatus.PENDING,
          failureReason: null,
          providerRaw: mergeRaw(refund.providerRaw, {
            retries: retries + 1,
            reconcileAttempts: 0,
          }),
        },
      });

      if (result.count === 0) {
        throw this.conflict();
      }

      await this.refundGateway.audit(tx, refund, actor, 'REFUND_RETRIED', {
        retries: retries + 1,
      });
    });
  }

  private notActionable() {
    return new ConflictException({
      message:
        'El reembolso no se puede gestionar en su estado actual. Si esta procesando, espera unos minutos.',
      code: 'REFUND_NOT_ACTIONABLE',
    });
  }

  private conflict() {
    return new ConflictException({
      message:
        'El saldo reembolsable del pago cambio. Recarga e intenta de nuevo.',
      code: 'REFUND_CONFLICT',
    });
  }
}

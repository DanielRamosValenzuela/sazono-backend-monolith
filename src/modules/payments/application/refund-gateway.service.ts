import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma, RefundMethod, RefundStatus, Role } from '@prisma/client';
import { AuditService } from '../../../common/audit/audit.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type { RefundResultResponseDto } from '../presentation/http/dto/refunds.dto';
import {
  PAYMENT_GATEWAY_RESOLVER,
  type PaymentGatewayResolverPort,
} from './ports/payment-gateway-resolver.port';
import type {
  GatewayRefundContext,
  GatewayRefundOutcome,
  PaymentGatewayRefundPort,
} from './ports/payment-gateway.port';
import {
  ACTIVE_ORDER_STATUSES,
  REFUND_INCLUDE,
  mapPaymentRefundState,
  mapRefund,
} from './refund-mapper';

export const GATEWAY_REFUND_INCLUDE = {
  ...REFUND_INCLUDE,
  payment: {
    select: {
      provider: true,
      providerReference: true,
      gatewayMeta: true,
      amount: true,
    },
  },
  restaurant: { select: { currency: true } },
} satisfies Prisma.RefundInclude;

export type GatewayRefundRecord = Prisma.RefundGetPayload<{
  include: typeof GATEWAY_REFUND_INCLUDE;
}>;

export type RefundActor = {
  staffUserId: string | null;
  role: Role | null;
  ip?: string | null;
  userAgent?: string | null;
};

export type ReconcileLimits = {
  maxAttempts: number;
  maxAgeMs: number;
};

export type ReconcileResult =
  'SUCCEEDED' | 'FAILED' | 'PENDING' | 'REQUIRES_MANUAL_REVIEW' | 'SKIPPED';

const SYSTEM_ACTOR: RefundActor = { staffUserId: null, role: null };
const OPEN_STATUSES: RefundStatus[] = [
  RefundStatus.PENDING,
  RefundStatus.REQUIRES_MANUAL_REVIEW,
];
const PROVIDER_LABELS: Record<string, string> = {
  MERCADO_PAGO: 'Mercado Pago',
  TRANSBANK: 'Transbank',
};
const NOT_REFUNDED_FAILURE_REASON =
  'La pasarela no registro el reembolso. Puedes reintentarlo o registrarlo como manual si ya devolviste el dinero.';
const NO_REFUND_SUPPORT_FAILURE_REASON =
  'La pasarela de este pago no permite reembolsos desde Sazono. Registra el reembolso como manual.';
const REVIEW_REASON =
  'No pudimos confirmar el estado del reembolso en la pasarela. Revisalo en el panel de la pasarela y registralo como manual o reintentalo.';

export function readRawObject(raw: Prisma.JsonValue | null): Prisma.JsonObject {
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
}

export function mergeRaw(
  existing: Prisma.JsonValue | null,
  patch: Record<string, unknown>,
): Prisma.InputJsonObject {
  return {
    ...readRawObject(existing),
    ...patch,
  } as Prisma.InputJsonObject;
}

@Injectable()
export class RefundGatewayService {
  private readonly logger = new Logger(RefundGatewayService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    @Inject(PAYMENT_GATEWAY_RESOLVER)
    private readonly gatewayResolver: PaymentGatewayResolverPort,
  ) {}

  load(refundId: string): Promise<GatewayRefundRecord | null> {
    return this.prisma.refund.findUnique({
      where: { id: refundId },
      include: GATEWAY_REFUND_INCLUDE,
    });
  }

  async dispatch(
    refundId: string,
    actor: RefundActor = SYSTEM_ACTOR,
  ): Promise<GatewayRefundRecord | null> {
    const refund = await this.load(refundId);

    if (!refund || refund.status !== RefundStatus.PENDING) {
      return refund;
    }

    const resolved = await this.buildContext(refund);

    if (resolved.kind === 'FAILURE') {
      await this.markFailed(
        refund,
        resolved.reason,
        { retryable: false },
        actor,
      );

      return this.load(refundId);
    }

    let outcome: GatewayRefundOutcome;

    try {
      outcome = await resolved.gateway.refund(resolved.context);
    } catch (error) {
      this.logger.error(
        `El reembolso ${refund.id} fallo de forma ambigua: ${
          error instanceof Error ? error.message : 'error desconocido'
        }`,
      );
      outcome = {
        kind: 'AMBIGUOUS',
        raw: { error: error instanceof Error ? error.message : 'unknown' },
      };
    }

    await this.applyOutcome(refund, outcome, actor);

    return this.load(refundId);
  }

  async reconcile(
    refund: GatewayRefundRecord,
    limits: ReconcileLimits,
    actor: RefundActor = SYSTEM_ACTOR,
  ): Promise<ReconcileResult> {
    if (!OPEN_STATUSES.includes(refund.status)) {
      return 'SKIPPED';
    }

    const resolved = await this.buildContext(refund);
    const raw = readRawObject(refund.providerRaw);
    const attempts = Number(raw.reconcileAttempts ?? 0) + 1;
    const expired =
      attempts >= limits.maxAttempts ||
      Date.now() - refund.createdAt.getTime() >= limits.maxAgeMs;

    if (resolved.kind === 'FAILURE') {
      return this.bumpOrEscalate(refund, attempts, expired, actor);
    }

    const state = await resolved.gateway.getRefundState({
      ...resolved.context,
      providerRefundReference: refund.providerRefundReference,
    });

    if (state.kind === 'REFUNDED') {
      await this.markSucceeded(
        refund,
        {
          kind: 'REFUNDED',
          providerRefundReference: state.providerRefundReference,
          raw: state.raw,
        },
        actor,
      );

      return 'SUCCEEDED';
    }

    if (state.kind === 'NOT_REFUNDED') {
      await this.markFailed(
        refund,
        NOT_REFUNDED_FAILURE_REASON,
        { retryable: true, state: state.raw ?? null },
        actor,
      );

      return 'FAILED';
    }

    return this.bumpOrEscalate(refund, attempts, expired, actor);
  }

  async toResult(
    refund: GatewayRefundRecord,
    idempotentReplay: boolean,
  ): Promise<RefundResultResponseDto> {
    const payment = await this.prisma.payment.findUniqueOrThrow({
      where: { id: refund.paymentId },
    });
    const activeOrders = await this.prisma.order.count({
      where: { billId: refund.billId, status: { in: ACTIVE_ORDER_STATUSES } },
    });

    return {
      refund: mapRefund(refund),
      payment: mapPaymentRefundState(payment),
      cashToHandOver: null,
      billActiveOrders: activeOrders,
      idempotentReplay,
    };
  }

  async reserve(
    tx: Prisma.TransactionClient,
    refund: Pick<
      GatewayRefundRecord,
      'paymentId' | 'billId' | 'amount' | 'tipAmount'
    >,
  ): Promise<boolean> {
    const amount = refund.amount.toFixed(2);
    const tip = refund.tipAmount.toFixed(2);
    const updated = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
      UPDATE payments
      SET refunded_amount = refunded_amount + ${amount}::numeric,
          refunded_tip_amount = refunded_tip_amount + ${tip}::numeric
      WHERE id = ${refund.paymentId}::uuid
        AND status = 'PAID'
        AND refunded_amount + ${amount}::numeric <= amount
        AND refunded_tip_amount + ${tip}::numeric <= tip_amount
        AND (refunded_amount - refunded_tip_amount) + (${amount}::numeric - ${tip}::numeric) <= (amount - tip_amount)
      RETURNING id
    `);

    if (updated.length === 0) {
      return false;
    }

    await tx.bill.update({
      where: { id: refund.billId },
      data: { refundedAmount: { increment: refund.amount } },
    });

    return true;
  }

  private async release(
    tx: Prisma.TransactionClient,
    refund: Pick<
      GatewayRefundRecord,
      'paymentId' | 'billId' | 'amount' | 'tipAmount'
    >,
  ): Promise<void> {
    const amount = refund.amount.toFixed(2);
    const tip = refund.tipAmount.toFixed(2);
    const updated = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
      UPDATE payments
      SET refunded_amount = refunded_amount - ${amount}::numeric,
          refunded_tip_amount = refunded_tip_amount - ${tip}::numeric
      WHERE id = ${refund.paymentId}::uuid
        AND refunded_amount >= ${amount}::numeric
        AND refunded_tip_amount >= ${tip}::numeric
        AND (refunded_amount - refunded_tip_amount) >= (${amount}::numeric - ${tip}::numeric)
      RETURNING id
    `);

    if (updated.length === 0) {
      throw new Error(
        `No se pudo liberar la reserva del reembolso sobre el pago ${refund.paymentId}.`,
      );
    }

    await tx.bill.update({
      where: { id: refund.billId },
      data: { refundedAmount: { decrement: refund.amount } },
    });
  }

  private async buildContext(refund: GatewayRefundRecord): Promise<
    | { kind: 'FAILURE'; reason: string }
    | {
        kind: 'OK';
        gateway: PaymentGatewayRefundPort;
        context: GatewayRefundContext;
      }
  > {
    const label = PROVIDER_LABELS[refund.payment.provider] ?? 'la pasarela';
    const resolved = (
      await this.gatewayResolver.resolveAvailable(refund.restaurantId)
    ).find((candidate) => candidate.provider === refund.payment.provider);

    if (!resolved) {
      return {
        kind: 'FAILURE',
        reason: `La cuenta de ${label} del restaurante no esta conectada o esta pausada, asi que no se pudo reembolsar. Si ya devolviste el dinero, registralo como manual.`,
      };
    }

    const gateway = resolved.gateway;

    if (
      !gateway.refund ||
      !gateway.getRefundState ||
      !refund.payment.providerReference
    ) {
      return { kind: 'FAILURE', reason: NO_REFUND_SUPPORT_FAILURE_REASON };
    }

    const already = await this.prisma.refund.aggregate({
      _sum: { amount: true },
      where: {
        paymentId: refund.paymentId,
        status: RefundStatus.SUCCEEDED,
        method: RefundMethod.GATEWAY,
        id: { not: refund.id },
      },
    });
    const meta = refund.payment.gatewayMeta;
    const retries = Number(readRawObject(refund.providerRaw).retries ?? 0);

    return {
      kind: 'OK',
      gateway: gateway as PaymentGatewayRefundPort,
      context: {
        restaurantId: refund.restaurantId,
        refundId: refund.id,
        idempotencyKey: retries > 0 ? `${refund.id}-r${retries}` : refund.id,
        providerReference: refund.payment.providerReference,
        amount: refund.amount,
        paymentAmount: refund.payment.amount,
        alreadyRefundedAmount: already._sum.amount ?? new Prisma.Decimal(0),
        currency: refund.restaurant.currency,
        credentials: resolved.credentials,
        gatewayMeta:
          meta && typeof meta === 'object' && !Array.isArray(meta)
            ? meta
            : null,
        providerRefundReference: refund.providerRefundReference,
      },
    };
  }

  private async applyOutcome(
    refund: GatewayRefundRecord,
    outcome: GatewayRefundOutcome,
    actor: RefundActor,
  ): Promise<void> {
    switch (outcome.kind) {
      case 'REFUNDED':
        await this.markSucceeded(refund, outcome, actor);
        return;
      case 'REJECTED':
        await this.markFailed(
          refund,
          outcome.failureReason,
          {
            retryable: outcome.retryable,
            code: outcome.code ?? null,
            gateway: outcome.raw ?? null,
          },
          actor,
        );
        return;
      case 'PENDING':
      case 'AMBIGUOUS':
        await this.prisma.refund.updateMany({
          where: { id: refund.id, status: RefundStatus.PENDING },
          data: {
            providerRaw: mergeRaw(refund.providerRaw, {
              gateway: outcome.raw ?? null,
              lastOutcome: outcome.kind,
            }),
            ...(outcome.kind === 'PENDING' && outcome.providerRefundReference
              ? { providerRefundReference: outcome.providerRefundReference }
              : {}),
          },
        });
        return;
    }
  }

  async markSucceeded(
    refund: GatewayRefundRecord,
    outcome: Extract<GatewayRefundOutcome, { kind: 'REFUNDED' }>,
    actor: RefundActor,
  ): Promise<void> {
    const write = (withReference: boolean) =>
      this.prisma.$transaction(async (tx) => {
        const result = await tx.refund.updateMany({
          where: { id: refund.id, status: { in: OPEN_STATUSES } },
          data: {
            status: RefundStatus.SUCCEEDED,
            completedAt: new Date(),
            failureReason: null,
            providerRaw: mergeRaw(refund.providerRaw, {
              gateway: outcome.raw ?? null,
            }),
            ...(withReference && outcome.providerRefundReference
              ? { providerRefundReference: outcome.providerRefundReference }
              : {}),
          },
        });

        if (result.count === 0) {
          return;
        }

        await this.audit(tx, refund, actor, 'REFUND_SUCCEEDED', {
          method: refund.method,
          providerRefundReference: outcome.providerRefundReference ?? null,
        });
      });

    try {
      await write(true);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        await write(false);
        return;
      }

      throw error;
    }
  }

  private async markFailed(
    refund: GatewayRefundRecord,
    reason: string,
    rawPatch: Record<string, unknown>,
    actor: RefundActor,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const result = await tx.refund.updateMany({
        where: { id: refund.id, status: { in: OPEN_STATUSES } },
        data: {
          status: RefundStatus.FAILED,
          failureReason: reason,
          providerRaw: mergeRaw(refund.providerRaw, rawPatch),
        },
      });

      if (result.count === 0) {
        return;
      }

      await this.release(tx, refund);
      await this.audit(tx, refund, actor, 'REFUND_FAILED', {
        failureReason: reason,
        reservationReleased: true,
      });
    });
  }

  private async bumpOrEscalate(
    refund: GatewayRefundRecord,
    attempts: number,
    expired: boolean,
    actor: RefundActor,
  ): Promise<ReconcileResult> {
    const providerRaw = mergeRaw(refund.providerRaw, {
      reconcileAttempts: attempts,
      lastReconcileAt: new Date().toISOString(),
    });

    if (!expired) {
      await this.prisma.refund.updateMany({
        where: { id: refund.id, status: { in: OPEN_STATUSES } },
        data: { providerRaw },
      });

      return 'PENDING';
    }

    await this.prisma.$transaction(async (tx) => {
      const result = await tx.refund.updateMany({
        where: { id: refund.id, status: RefundStatus.PENDING },
        data: {
          status: RefundStatus.REQUIRES_MANUAL_REVIEW,
          failureReason: REVIEW_REASON,
          providerRaw,
        },
      });

      if (result.count > 0) {
        await this.audit(tx, refund, actor, 'REFUND_REQUIRES_MANUAL_REVIEW', {
          attempts,
          reservationKept: true,
        });
      }
    });

    return 'REQUIRES_MANUAL_REVIEW';
  }

  async audit(
    tx: Prisma.TransactionClient,
    refund: Pick<
      GatewayRefundRecord,
      'id' | 'restaurantId' | 'branchId' | 'paymentId' | 'billId' | 'amount'
    >,
    actor: RefundActor,
    action: string,
    after: Record<string, unknown>,
    reason?: string,
  ): Promise<void> {
    await this.auditService.record(tx, {
      restaurantId: refund.restaurantId,
      branchId: refund.branchId,
      actorStaffUserId: actor.staffUserId,
      actorRole: actor.role,
      action,
      entityType: 'Refund',
      entityId: refund.id,
      after: {
        paymentId: refund.paymentId,
        billId: refund.billId,
        amount: refund.amount.toString(),
        ...after,
      },
      reason: reason ?? null,
      ip: actor.ip ?? null,
      userAgent: actor.userAgent ?? null,
    });
  }
}

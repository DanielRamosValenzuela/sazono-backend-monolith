import { Injectable, Logger } from '@nestjs/common';
import { Prisma, RefundMethod, RefundStatus } from '@prisma/client';
import { AuditService } from '../../../common/audit/audit.service';
import { enqueueCreditNoteForRefund } from '../../billing/application/create-pending-credit-note.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { MERCADOPAGO_PROVIDER_NAME } from '../domain/mercado-pago-status';
import { computeRefundNet, computeRefundable } from '../domain/refund-amounts';
import type {
  GatewayPaymentSnapshot,
  GatewayRemoteRefund,
} from './ports/payment-gateway.port';
import { STALE_PENDING_REFUND_MS } from './manage-gateway-refund.service';
import {
  GATEWAY_REFUND_INCLUDE,
  RefundGatewayService,
  type GatewayRefundRecord,
} from './refund-gateway.service';

export const EXTERNAL_REFUND_REASON_TEXT =
  'Reembolso realizado desde el panel de Mercado Pago';

const SYSTEM_ACTOR = { staffUserId: null, role: null };

type PaymentRecord = Prisma.PaymentGetPayload<{
  include: {
    bill: {
      select: {
        id: true;
        branchId: true;
        branch: { select: { restaurantId: true } };
      };
    };
  };
}>;

type ExternalOutcome = 'CREATED' | 'EXCEEDS' | 'DUPLICATE';

@Injectable()
export class ReconcileMercadoPagoRefundsService {
  private readonly logger = new Logger(ReconcileMercadoPagoRefundsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly refundGateway: RefundGatewayService,
  ) {}

  async execute(snapshot: GatewayPaymentSnapshot): Promise<void> {
    const chargedBack =
      snapshot.chargedBack === true ||
      snapshot.rawStatus.toLowerCase() === 'charged_back';
    const approved = (snapshot.refunds ?? []).filter(
      (refund) => refund.outcome === 'APPROVED',
    );

    if (!chargedBack && approved.length === 0) {
      return;
    }

    const payment = await this.prisma.payment.findFirst({
      where: {
        provider: MERCADOPAGO_PROVIDER_NAME,
        providerReference: snapshot.providerReference,
      },
      include: {
        bill: {
          select: {
            id: true,
            branchId: true,
            branch: { select: { restaurantId: true } },
          },
        },
      },
    });

    if (!payment) {
      return;
    }

    if (chargedBack) {
      await this.markDisputed(payment);
    }

    for (const remote of approved) {
      await this.reconcileRemoteRefund(payment, remote);
    }
  }

  private async markDisputed(payment: PaymentRecord): Promise<void> {
    const result = await this.prisma.payment.updateMany({
      where: { id: payment.id, disputed: false },
      data: { disputed: true },
    });

    if (result.count === 0) {
      return;
    }

    this.logger.warn(
      `Mercado Pago reporto un contracargo sobre el pago ${payment.id}.`,
    );
    await this.auditService.record(null, {
      restaurantId: payment.bill.branch.restaurantId,
      branchId: payment.bill.branchId,
      actorStaffUserId: null,
      actorRole: null,
      action: 'PAYMENT_DISPUTED',
      entityType: 'Payment',
      entityId: payment.id,
      after: {
        provider: MERCADOPAGO_PROVIDER_NAME,
        providerReference: payment.providerReference,
        source: 'WEBHOOK',
      },
    });
  }

  private conciliate(
    refund: GatewayRefundRecord,
    remote: GatewayRemoteRefund,
  ): Promise<void> {
    return this.refundGateway.markSucceeded(
      refund,
      {
        kind: 'REFUNDED',
        providerRefundReference: remote.reference,
        raw: { webhook: remote },
      },
      SYSTEM_ACTOR,
    );
  }

  private async reconcileRemoteRefund(
    payment: PaymentRecord,
    remote: GatewayRemoteRefund,
  ): Promise<void> {
    const known = await this.prisma.refund.findFirst({
      where: {
        provider: MERCADOPAGO_PROVIDER_NAME,
        providerRefundReference: remote.reference,
      },
      include: GATEWAY_REFUND_INCLUDE,
    });

    if (known) {
      if (
        known.status === RefundStatus.PENDING ||
        known.status === RefundStatus.REQUIRES_MANUAL_REVIEW
      ) {
        await this.conciliate(known, remote);
      }

      return;
    }

    const own = await this.prisma.refund.findFirst({
      where: {
        paymentId: payment.id,
        method: RefundMethod.GATEWAY,
        source: 'STAFF',
        status: {
          in: [RefundStatus.PENDING, RefundStatus.REQUIRES_MANUAL_REVIEW],
        },
        providerRefundReference: null,
        amount: new Prisma.Decimal(remote.amount),
        createdAt: { lt: new Date(Date.now() - STALE_PENDING_REFUND_MS) },
      },
      include: GATEWAY_REFUND_INCLUDE,
      orderBy: { createdAt: 'asc' },
    });

    if (own) {
      await this.conciliate(own, remote);

      return;
    }

    if (await this.bindManualRefund(payment, remote)) {
      return;
    }

    const outcome = await this.createExternalRefund(payment, remote);

    if (outcome === 'EXCEEDS') {
      this.logger.warn(
        `El reembolso externo ${remote.reference} de Mercado Pago supera el saldo reembolsable del pago ${payment.id}; se omite.`,
      );
      await this.auditService.record(null, {
        restaurantId: payment.bill.branch.restaurantId,
        branchId: payment.bill.branchId,
        actorStaffUserId: null,
        actorRole: null,
        action: 'REFUND_EXTERNAL_SKIPPED',
        entityType: 'Payment',
        entityId: payment.id,
        after: {
          providerRefundReference: remote.reference,
          amount: remote.amount,
          reason: 'EXCEEDS_REFUNDABLE',
        },
      });
    }
  }

  private async bindManualRefund(
    payment: PaymentRecord,
    remote: GatewayRemoteRefund,
  ): Promise<boolean> {
    const manual = await this.prisma.refund.findFirst({
      where: {
        paymentId: payment.id,
        method: RefundMethod.MANUAL_EXTERNAL,
        status: RefundStatus.SUCCEEDED,
        providerRefundReference: null,
        amount: new Prisma.Decimal(remote.amount),
      },
      orderBy: { createdAt: 'asc' },
    });

    if (!manual) {
      return false;
    }

    const bound = await this.prisma.refund.updateMany({
      where: { id: manual.id, providerRefundReference: null },
      data: {
        provider: MERCADOPAGO_PROVIDER_NAME,
        providerRefundReference: remote.reference,
      },
    });

    if (bound.count === 0) {
      return false;
    }

    await this.auditService.record(null, {
      restaurantId: payment.bill.branch.restaurantId,
      branchId: payment.bill.branchId,
      actorStaffUserId: null,
      actorRole: null,
      action: 'REFUND_EXTERNAL_BOUND',
      entityType: 'Refund',
      entityId: manual.id,
      after: {
        providerRefundReference: remote.reference,
        amount: remote.amount,
      },
    });

    return true;
  }

  private async createExternalRefund(
    payment: PaymentRecord,
    remote: GatewayRemoteRefund,
  ): Promise<ExternalOutcome> {
    const amount = new Prisma.Decimal(remote.amount);

    try {
      return await this.prisma.$transaction(async (tx) => {
        const fresh = await tx.payment.findUniqueOrThrow({
          where: { id: payment.id },
        });
        const refundable = computeRefundable(fresh);
        const tipAmount = amount.gt(refundable.consumption)
          ? amount.sub(refundable.consumption)
          : new Prisma.Decimal(0);

        if (amount.lte(0) || tipAmount.gt(refundable.tip)) {
          return 'EXCEEDS' as const;
        }

        const consumptionAmount = amount.sub(tipAmount);
        const updated = await tx.$queryRaw<
          {
            refunded_amount: Prisma.Decimal;
            refunded_tip_amount: Prisma.Decimal;
          }[]
        >(Prisma.sql`
          UPDATE payments
          SET refunded_amount = refunded_amount + ${amount.toFixed(2)}::numeric,
              refunded_tip_amount = refunded_tip_amount + ${tipAmount.toFixed(2)}::numeric
          WHERE id = ${payment.id}::uuid
            AND status = 'PAID'
            AND refunded_amount + ${amount.toFixed(2)}::numeric <= amount
            AND refunded_tip_amount + ${tipAmount.toFixed(2)}::numeric <= tip_amount
            AND (refunded_amount - refunded_tip_amount) + (${amount.toFixed(2)}::numeric - ${tipAmount.toFixed(2)}::numeric) <= (amount - tip_amount)
          RETURNING refunded_amount, refunded_tip_amount
        `);

        if (updated.length === 0) {
          return 'EXCEEDS' as const;
        }

        const consumptionBefore = new Prisma.Decimal(
          updated[0].refunded_amount.toString(),
        )
          .sub(updated[0].refunded_tip_amount.toString())
          .sub(consumptionAmount);
        const { netAmount, vatAmount } = computeRefundNet(
          consumptionBefore,
          consumptionAmount,
        );
        const refund = await tx.refund.create({
          data: {
            restaurantId: payment.bill.branch.restaurantId,
            branchId: payment.bill.branchId,
            billId: payment.billId,
            paymentId: payment.id,
            amount,
            tipAmount,
            netAmount,
            vatAmount,
            status: RefundStatus.SUCCEEDED,
            method: RefundMethod.GATEWAY,
            reasonCode: 'OTHER',
            reasonText: EXTERNAL_REFUND_REASON_TEXT,
            idempotencyKey: `mp-refund-${remote.reference}`,
            provider: MERCADOPAGO_PROVIDER_NAME,
            providerRefundReference: remote.reference,
            providerRaw: { webhook: remote },
            source: 'WEBHOOK',
            creditNoteStatus: consumptionAmount.gt(0)
              ? 'PENDING'
              : 'NOT_REQUIRED',
            completedAt: new Date(),
          },
        });

        await tx.bill.update({
          where: { id: payment.billId },
          data: { refundedAmount: { increment: amount } },
        });
        await enqueueCreditNoteForRefund(tx, refund.id, refund);
        await this.refundGateway.audit(
          tx,
          refund,
          SYSTEM_ACTOR,
          'REFUND_SUCCEEDED',
          {
            source: 'WEBHOOK',
            method: RefundMethod.GATEWAY,
            providerRefundReference: remote.reference,
            tipAmount: tipAmount.toString(),
            netAmount: netAmount.toString(),
            vatAmount: vatAmount.toString(),
          },
          EXTERNAL_REFUND_REASON_TEXT,
        );

        return 'CREATED' as const;
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        return 'DUPLICATE';
      }

      throw error;
    }
  }
}

import { ConflictException, Injectable } from '@nestjs/common';
import type { Payment } from '@prisma/client';
import {
  PaymentAttemptStatus,
  PaymentMethod,
  PaymentStatus,
  Prisma,
} from '@prisma/client';
import { findOpenCashSessionId } from './find-open-cash-session';

export const PaymentSource = {
  WEB_QR: 'WEB_QR',
  CASHIER: 'CASHIER',
  WAITER: 'WAITER',
} as const;

export type PaymentSource = (typeof PaymentSource)[keyof typeof PaymentSource];

export type FinalizePaymentInput = {
  attemptId: string;
  billId: string;
  billSplitParticipantId?: string;
  amount: Prisma.Decimal;
  currency: string;
  provider: string;
  providerReference?: string | null;
  tipAmount?: Prisma.Decimal;
  method?: PaymentMethod | null;
  staffUserId?: string | null;
  source?: PaymentSource;
  gatewayMeta?: Prisma.InputJsonObject;
};

@Injectable()
export class FinalizePaymentService {
  async execute(
    tx: Prisma.TransactionClient,
    input: FinalizePaymentInput,
  ): Promise<Payment> {
    const updatedAttempts = await tx.paymentAttempt.updateMany({
      where: {
        id: input.attemptId,
        status: PaymentAttemptStatus.PENDING,
      },
      data: {
        status: PaymentAttemptStatus.SUCCEEDED,
        providerReference: input.providerReference ?? null,
      },
    });

    if (updatedAttempts.count === 0) {
      throw new ConflictException('El intento de pago ya fue resuelto.');
    }

    const cashSessionId = await this.resolveCashSessionId(tx, input);

    return tx.payment.create({
      data: {
        billId: input.billId,
        billSplitParticipantId: input.billSplitParticipantId ?? null,
        amount: input.amount,
        currency: input.currency,
        provider: input.provider,
        providerReference: input.providerReference ?? null,
        status: PaymentStatus.PAID,
        paidAt: new Date(),
        tipAmount: input.tipAmount ?? new Prisma.Decimal(0),
        method: input.method ?? null,
        staffUserId: input.staffUserId ?? null,
        cashSessionId,
        source: input.source ?? null,
        gatewayMeta: input.gatewayMeta ?? Prisma.DbNull,
      },
    });
  }

  private async resolveCashSessionId(
    tx: Prisma.TransactionClient,
    input: FinalizePaymentInput,
  ): Promise<string | null> {
    if (!input.staffUserId) {
      return null;
    }

    const bill = await tx.bill.findUnique({
      where: { id: input.billId },
      select: {
        branchId: true,
        branch: {
          select: {
            settings: { select: { requireOpenCashSession: true } },
          },
        },
      },
    });

    if (!bill) {
      return null;
    }

    const sessionId = await findOpenCashSessionId(
      tx,
      bill.branchId,
      input.staffUserId,
    );

    if (
      !sessionId &&
      input.method === PaymentMethod.CASH &&
      bill.branch.settings?.requireOpenCashSession
    ) {
      throw new ConflictException({
        message: 'Debes abrir tu caja antes de cobrar en efectivo.',
        code: 'CASH_SESSION_REQUIRED',
      });
    }

    return sessionId;
  }
}

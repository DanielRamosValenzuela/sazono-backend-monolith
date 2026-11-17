import { ConflictException, Injectable } from '@nestjs/common';
import type { Payment, PaymentMethod } from '@prisma/client';
import { PaymentAttemptStatus, PaymentStatus, Prisma } from '@prisma/client';

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
        source: input.source ?? null,
        gatewayMeta: input.gatewayMeta ?? Prisma.DbNull,
      },
    });
  }
}

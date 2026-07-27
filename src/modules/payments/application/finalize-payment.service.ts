import { ConflictException, Injectable } from '@nestjs/common';
import type { Payment, Prisma } from '@prisma/client';
import { PaymentAttemptStatus, PaymentStatus } from '@prisma/client';

export type FinalizePaymentInput = {
  attemptId: string;
  billId: string;
  billSplitParticipantId?: string;
  amount: Prisma.Decimal;
  currency: string;
  provider: string;
  providerReference?: string | null;
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
      },
    });
  }
}

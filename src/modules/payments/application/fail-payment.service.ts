import { ConflictException, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PaymentAttemptStatus } from '@prisma/client';

export type FailPaymentInput = {
  attemptId: string;
  providerReference?: string | null;
  failureReason: string;
};

@Injectable()
export class FailPaymentService {
  async execute(
    tx: Prisma.TransactionClient,
    input: FailPaymentInput,
  ): Promise<void> {
    const updatedAttempts = await tx.paymentAttempt.updateMany({
      where: {
        id: input.attemptId,
        status: PaymentAttemptStatus.PENDING,
      },
      data: {
        status: PaymentAttemptStatus.FAILED,
        providerReference: input.providerReference ?? null,
        failureReason: input.failureReason,
      },
    });

    if (updatedAttempts.count === 0) {
      throw new ConflictException('El intento de pago ya fue resuelto.');
    }
  }
}

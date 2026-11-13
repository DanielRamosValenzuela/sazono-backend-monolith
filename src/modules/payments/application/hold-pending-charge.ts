import { ConflictException } from '@nestjs/common';
import { PaymentAttemptStatus } from '@prisma/client';
import { MERCADOPAGO_PROVIDER_NAME } from '../domain/mercado-pago-status';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { ChargePaymentResult } from './charge-payment.service';
import { PAYMENT_IN_REVIEW_BODY } from './require-settled-charge';

export type PendingChargePaymentResult = Extract<
  ChargePaymentResult,
  { kind: 'PENDING' }
>;

export async function holdPendingCharge(
  prisma: PrismaService,
  attemptId: string,
  result: PendingChargePaymentResult,
): Promise<never> {
  await prisma.paymentAttempt.updateMany({
    where: { id: attemptId, status: PaymentAttemptStatus.PENDING },
    data: {
      provider: result.providerName,
      providerReference: result.providerReference,
    },
  });

  throw new ConflictException(PAYMENT_IN_REVIEW_BODY);
}

export async function assertNoPaymentInReview(
  prisma: PrismaService,
  billId: string,
): Promise<void> {
  const inReview = await prisma.paymentAttempt.findFirst({
    where: {
      billId,
      provider: MERCADOPAGO_PROVIDER_NAME,
      status: PaymentAttemptStatus.PENDING,
      OR: [
        { providerReference: { startsWith: 'ORD' } },
        { providerReference: null },
      ],
    },
    select: { id: true },
  });

  if (inReview) {
    throw new ConflictException(PAYMENT_IN_REVIEW_BODY);
  }
}

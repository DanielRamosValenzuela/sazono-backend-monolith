import type { OrderStatus, Payment } from '@prisma/client';
import type { BillAfterPayment } from './apply-payment-to-bill';
import type { PaymentResultResponseDto } from '../presentation/http/dto/payments.dto';

export type PaidOrderSummary = {
  orderId: string;
  status: OrderStatus;
};

export function mapPaymentResult(
  payment: Payment,
  billAfterPayment: BillAfterPayment,
  order: PaidOrderSummary | null,
): PaymentResultResponseDto {
  return {
    paymentId: payment.id,
    billId: payment.billId,
    amount: payment.amount.toString(),
    currency: payment.currency,
    provider: payment.provider,
    providerReference: payment.providerReference,
    status: payment.status,
    paidAt: payment.paidAt?.toISOString() ?? null,
    bill: {
      billId: billAfterPayment.billId,
      status: billAfterPayment.status,
      subtotalAmount: billAfterPayment.subtotalAmount.toString(),
      tipAmount: billAfterPayment.tipAmount.toString(),
      totalAmount: billAfterPayment.totalAmount.toString(),
      remainingAmount: billAfterPayment.remainingAmount.toString(),
    },
    order,
  };
}

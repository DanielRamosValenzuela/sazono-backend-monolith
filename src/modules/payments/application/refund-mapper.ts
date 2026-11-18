import { OrderStatus, type Prisma } from '@prisma/client';
import { computeRefundable } from '../domain/refund-amounts';
import type {
  RefundPaymentStateDto,
  RefundResponseDto,
} from '../presentation/http/dto/refunds.dto';

export const REFUND_INCLUDE = {
  requestedBy: { select: { id: true, firstName: true, lastName: true } },
  approvedBy: { select: { id: true, firstName: true, lastName: true } },
} satisfies Prisma.RefundInclude;

export type RefundRecord = Prisma.RefundGetPayload<{
  include: typeof REFUND_INCLUDE;
}>;

type StaffName = { id: string; firstName: string; lastName: string };

const staffName = (staff: StaffName) =>
  `${staff.firstName} ${staff.lastName}`.trim();

export function mapRefund(refund: RefundRecord): RefundResponseDto {
  return {
    refundId: refund.id,
    paymentId: refund.paymentId,
    billId: refund.billId,
    amount: refund.amount.toString(),
    tipAmount: refund.tipAmount.toString(),
    consumptionAmount: refund.amount.sub(refund.tipAmount).toString(),
    netAmount: refund.netAmount.toString(),
    vatAmount: refund.vatAmount.toString(),
    status: refund.status,
    method: refund.method,
    reasonCode: refund.reasonCode,
    reasonText: refund.reasonText,
    requestedBy: refund.requestedBy
      ? {
          staffUserId: refund.requestedBy.id,
          name: staffName(refund.requestedBy),
          role: refund.requestedByRole,
        }
      : null,
    approvedBy: refund.approvedBy
      ? {
          staffUserId: refund.approvedBy.id,
          name: staffName(refund.approvedBy),
        }
      : null,
    creditNoteStatus: refund.creditNoteStatus,
    completedAt: refund.completedAt?.toISOString() ?? null,
    createdAt: refund.createdAt.toISOString(),
  };
}

export type PaymentRefundSnapshot = {
  id: string;
  amount: Prisma.Decimal;
  tipAmount: Prisma.Decimal;
  refundedAmount: Prisma.Decimal;
  refundedTipAmount: Prisma.Decimal;
};

export function mapPaymentRefundState(
  payment: PaymentRefundSnapshot,
): RefundPaymentStateDto {
  const refundable = computeRefundable(payment);

  return {
    paymentId: payment.id,
    amount: payment.amount.toString(),
    tipAmount: payment.tipAmount.toString(),
    refundedAmount: payment.refundedAmount.toString(),
    refundedTipAmount: payment.refundedTipAmount.toString(),
    refundable: {
      total: refundable.total.toString(),
      consumption: refundable.consumption.toString(),
      tip: refundable.tip.toString(),
    },
  };
}

export const ACTIVE_ORDER_STATUSES: OrderStatus[] = [
  OrderStatus.CONFIRMED,
  OrderStatus.ROUTED,
  OrderStatus.IN_PREPARATION,
  OrderStatus.PARTIALLY_READY,
  OrderStatus.READY,
];

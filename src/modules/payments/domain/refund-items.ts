import { Prisma } from '@prisma/client';

export type RefundLineInput = {
  quantity: number;
  refundedQuantity: number;
  netAmount: Prisma.Decimal;
  refundedAmount: Prisma.Decimal;
  requested: number;
};

export function computeLineRefundAmount(line: RefundLineInput): Prisma.Decimal {
  const remainingNet = line.netAmount.sub(line.refundedAmount);

  if (line.refundedQuantity + line.requested >= line.quantity) {
    return Prisma.Decimal.max(0, remainingNet);
  }

  const prorated = line.netAmount
    .mul(line.requested)
    .div(line.quantity)
    .toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP);

  return Prisma.Decimal.max(0, Prisma.Decimal.min(prorated, remainingNet));
}

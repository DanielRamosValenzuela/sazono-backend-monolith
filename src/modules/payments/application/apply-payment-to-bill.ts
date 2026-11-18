import { BadRequestException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { BillStatus } from '@prisma/client';
import { lockBill } from '../../billing/application/lock-bill';
import { computeBillTotals } from '../../billing/domain/tax-policy';
import { settleBillIfFullyPaid } from './settle-bill-if-fully-paid';

export type BillAfterPayment = {
  billId: string;
  status: BillStatus;
  subtotalAmount: Prisma.Decimal;
  discountAmount: Prisma.Decimal;
  tipAmount: Prisma.Decimal;
  totalAmount: Prisma.Decimal;
  remainingAmount: Prisma.Decimal;
};
export async function applyPaymentToBill(
  tx: Prisma.TransactionClient,
  billId: string,
  paidAmount: Prisma.Decimal,
  tipDelta: Prisma.Decimal,
): Promise<BillAfterPayment> {
  await lockBill(tx, billId);

  const bill = await tx.bill.findUniqueOrThrow({
    where: {
      id: billId,
    },
  });

  const tipAmount = bill.tipAmount.add(tipDelta);
  const { taxAmount, totalAmount } = computeBillTotals(
    bill.subtotalAmount,
    tipAmount,
    bill.discountAmount,
  );

  const alreadyPaid = bill.totalAmount.sub(bill.remainingAmount);
  const remainingAmount = totalAmount.sub(alreadyPaid).sub(paidAmount);

  if (remainingAmount.lt(0)) {
    throw new BadRequestException(
      'El monto pagado supera el saldo pendiente de la cuenta.',
    );
  }

  const status = remainingAmount.lte(0)
    ? BillStatus.PAID
    : BillStatus.PARTIALLY_PAID;

  await tx.bill.update({
    where: {
      id: bill.id,
    },
    data: {
      tipAmount,
      taxAmount,
      totalAmount,
      remainingAmount,
      status,
    },
  });

  if (remainingAmount.lte(0)) {
    await settleBillIfFullyPaid(tx, bill);
  }

  return {
    billId: bill.id,
    status,
    subtotalAmount: bill.subtotalAmount,
    discountAmount: bill.discountAmount,
    tipAmount,
    totalAmount,
    remainingAmount,
  };
}

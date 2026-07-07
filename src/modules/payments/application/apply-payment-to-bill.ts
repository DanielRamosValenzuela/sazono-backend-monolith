import { BadRequestException } from '@nestjs/common';
import { BillStatus, Prisma, TableSessionStatus } from '@prisma/client';
import { computeBillTotals } from '../../billing/domain/tax-policy';

export type BillAfterPayment = {
  billId: string;
  status: BillStatus;
  subtotalAmount: Prisma.Decimal;
  tipAmount: Prisma.Decimal;
  totalAmount: Prisma.Decimal;
  remainingAmount: Prisma.Decimal;
};

/**
 * Asienta un pago aprobado sobre la cuenta: suma la propina al total,
 * descuenta el monto pagado del saldo y actualiza el estado de la cuenta.
 *
 * Cuando el saldo llega a cero, la sesion pasa a PAYMENT_COMPLETED. La mesa
 * nunca se cierra automaticamente: el cierre sigue siendo manual.
 */
export async function applyPaymentToBill(
  tx: Prisma.TransactionClient,
  billId: string,
  paidAmount: Prisma.Decimal,
  tipDelta: Prisma.Decimal,
): Promise<BillAfterPayment> {
  const bill = await tx.bill.findUniqueOrThrow({
    where: {
      id: billId,
    },
  });

  const tipAmount = bill.tipAmount.add(tipDelta);
  const { taxAmount, totalAmount } = computeBillTotals(
    bill.subtotalAmount,
    tipAmount,
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
    await tx.tableSession.updateMany({
      where: {
        id: bill.tableSessionId,
        status: TableSessionStatus.OPEN,
      },
      data: {
        status: TableSessionStatus.PAYMENT_COMPLETED,
      },
    });
  }

  return {
    billId: bill.id,
    status,
    subtotalAmount: bill.subtotalAmount,
    tipAmount,
    totalAmount,
    remainingAmount,
  };
}

import { BillStatus, Prisma, TableSessionStatus } from '@prisma/client';
import { computeBillTotals } from '../../billing/domain/tax-policy';

export type OrderChargeItem = {
  orderItemId: string;
  name: string;
  price: Prisma.Decimal;
  quantity: number;
};

type BillSnapshot = {
  id: string;
  tableSessionId: string;
  subtotalAmount: Prisma.Decimal;
  tipAmount: Prisma.Decimal;
  totalAmount: Prisma.Decimal;
  remainingAmount: Prisma.Decimal;
};
export async function applyOrderChargeToBill(
  tx: Prisma.TransactionClient,
  bill: BillSnapshot,
  orderItems: OrderChargeItem[],
): Promise<void> {
  await tx.billItem.createMany({
    data: orderItems.map((item) => ({
      billId: bill.id,
      orderItemId: item.orderItemId,
      description: item.name,
      quantity: item.quantity,
      unitPrice: item.price,
      totalPrice: item.price.mul(item.quantity),
    })),
  });

  const chargeAmount = orderItems.reduce(
    (total, item) => total.add(item.price.mul(item.quantity)),
    new Prisma.Decimal(0),
  );

  const paidAmount = bill.totalAmount.sub(bill.remainingAmount);
  const subtotalAmount = bill.subtotalAmount.add(chargeAmount);
  const { taxAmount, totalAmount } = computeBillTotals(
    subtotalAmount,
    bill.tipAmount,
  );
  const remainingAmount = totalAmount.sub(paidAmount);

  const status = paidAmount.lte(0)
    ? BillStatus.OPEN
    : remainingAmount.lte(0)
      ? BillStatus.PAID
      : BillStatus.PARTIALLY_PAID;

  await tx.bill.update({
    where: {
      id: bill.id,
    },
    data: {
      subtotalAmount,
      taxAmount,
      totalAmount,
      remainingAmount,
      status,
    },
  });

  if (remainingAmount.gt(0)) {
    await tx.tableSession.updateMany({
      where: {
        id: bill.tableSessionId,
        status: TableSessionStatus.PAYMENT_COMPLETED,
      },
      data: {
        status: TableSessionStatus.OPEN,
      },
    });
  }
}

import type { PrismaClient } from '@prisma/client';
import {
  BillItemStatus,
  BillStatus,
  Prisma,
  TableSessionStatus,
} from '@prisma/client';
import { lockBill } from '../../billing/application/lock-bill';
import { refreshBillDiscounts } from '../../billing/application/refresh-bill-discounts';
import { computeDiscounts } from '../../billing/domain/discount-policy';
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
  billSnapshot: BillSnapshot,
  orderItems: OrderChargeItem[],
): Promise<void> {
  await lockBill(tx, billSnapshot.id);

  const bill = await tx.bill.findUniqueOrThrow({
    where: { id: billSnapshot.id },
  });

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
  const discountAmount = await refreshBillDiscounts(tx, bill.id);
  const { taxAmount, totalAmount } = computeBillTotals(
    subtotalAmount,
    bill.tipAmount,
    discountAmount,
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
      discountAmount,
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

export async function computeOrderChargeDelta(
  client: Prisma.TransactionClient | PrismaClient,
  billId: string,
  orderItems: Pick<OrderChargeItem, 'orderItemId' | 'price' | 'quantity'>[],
): Promise<Prisma.Decimal> {
  const chargeAmount = orderItems.reduce(
    (total, item) => total.add(item.price.mul(item.quantity)),
    new Prisma.Decimal(0),
  );
  const active = await client.billDiscount.findMany({
    where: { billId, voidedAt: null },
    orderBy: { createdAt: 'asc' },
  });

  if (active.length === 0) {
    return chargeAmount;
  }

  const bill = await client.bill.findUniqueOrThrow({ where: { id: billId } });
  const openItems = await client.billItem.findMany({
    where: { billId, status: BillItemStatus.OPEN },
    select: { id: true, totalPrice: true },
  });
  const { totalDiscount } = computeDiscounts({
    lines: [
      ...openItems.map((item) => ({
        billItemId: item.id,
        totalPrice: item.totalPrice,
      })),
      ...orderItems.map((item) => ({
        billItemId: item.orderItemId,
        totalPrice: item.price.mul(item.quantity),
      })),
    ],
    discounts: active.map((d) => ({
      id: d.id,
      billItemId: d.billItemId,
      type: d.type,
      value: d.value,
    })),
  });
  const { totalAmount } = computeBillTotals(
    bill.subtotalAmount.add(chargeAmount),
    bill.tipAmount,
    totalDiscount,
  );

  return totalAmount.sub(bill.totalAmount);
}

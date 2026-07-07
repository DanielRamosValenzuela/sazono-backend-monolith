import { BillStatus, Prisma } from '@prisma/client';
import { computeBillTotals } from '../../billing/domain/tax-policy';
import type { OrderableMenuItem } from './orderable-menu-item-resolver.service';

type BillSnapshot = {
  id: string;
  subtotalAmount: Prisma.Decimal;
  tipAmount: Prisma.Decimal;
  totalAmount: Prisma.Decimal;
  remainingAmount: Prisma.Decimal;
};

/**
 * Suma los items de una orden a la cuenta de la sesion: crea los bill items
 * y recalcula subtotal, total, saldo pendiente y estado de la cuenta.
 *
 * Debe ejecutarse dentro de la misma transaccion que crea la orden (flujo
 * pospago de mesero) o que aprueba el pago (flujo prepago QR).
 */
export async function applyOrderChargeToBill(
  tx: Prisma.TransactionClient,
  bill: BillSnapshot,
  orderItems: Array<OrderableMenuItem & { orderItemId: string }>,
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
}

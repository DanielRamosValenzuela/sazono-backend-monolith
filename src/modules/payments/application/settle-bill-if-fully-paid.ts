import type { Prisma } from '@prisma/client';
import { enqueueBoletaForPaidBill } from '../../billing/application/enqueue-boleta';
import {
  OrderItemStatus,
  OrderStatus,
  TableSessionStatus,
} from '@prisma/client';

export async function settleBillIfFullyPaid(
  tx: Prisma.TransactionClient,
  bill: { id: string; tableSessionId: string },
): Promise<void> {
  await tx.orderItem.updateMany({
    where: {
      order: { billId: bill.id, status: OrderStatus.READY },
      status: { not: OrderItemStatus.CANCELLED },
    },
    data: { status: OrderItemStatus.DELIVERED },
  });
  await tx.order.updateMany({
    where: { billId: bill.id, status: OrderStatus.READY },
    data: { status: OrderStatus.DELIVERED },
  });
  await tx.tableSession.updateMany({
    where: {
      id: bill.tableSessionId,
      status: TableSessionStatus.OPEN,
    },
    data: {
      status: TableSessionStatus.PAYMENT_COMPLETED,
    },
  });
  await enqueueBoletaForPaidBill(tx, bill.id);
}

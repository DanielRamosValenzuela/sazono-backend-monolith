import { BillItemStatus, Prisma } from '@prisma/client';
import { computeDiscounts } from '../domain/discount-policy';

const ZERO = new Prisma.Decimal(0);

export async function refreshBillDiscounts(
  tx: Prisma.TransactionClient,
  billId: string,
  options: { resetWhenEmpty?: boolean } = {},
): Promise<Prisma.Decimal> {
  const active = await tx.billDiscount.findMany({
    where: { billId, voidedAt: null },
    orderBy: { createdAt: 'asc' },
  });

  if (active.length === 0) {
    if (options.resetWhenEmpty) {
      await tx.billItem.updateMany({
        where: { billId, discountAmount: { gt: 0 } },
        data: { discountAmount: ZERO },
      });
    }

    return ZERO;
  }

  const items = await tx.billItem.findMany({
    where: { billId },
    select: { id: true, totalPrice: true, status: true, discountAmount: true },
  });
  const openItems = items.filter((item) => item.status === BillItemStatus.OPEN);
  const openIds = new Set(openItems.map((item) => item.id));
  const now = new Date();
  const orphans = active.filter(
    (d) => d.billItemId && !openIds.has(d.billItemId),
  );

  for (const orphan of orphans) {
    await tx.billDiscount.update({
      where: { id: orphan.id },
      data: {
        voidedAt: now,
        voidedByStaffUserId: orphan.appliedByStaffUserId,
        voidReason: 'LINE_VOIDED',
        amount: ZERO,
      },
    });
    await tx.auditLog.create({
      data: {
        restaurantId: orphan.restaurantId,
        branchId: orphan.branchId,
        action: 'DISCOUNT_RECALCULATED',
        entityType: 'BillDiscount',
        entityId: orphan.id,
        before: { amount: orphan.amount.toString() },
        after: { amount: '0', voidReason: 'LINE_VOIDED' },
      },
    });
  }

  const live = active.filter((d) => !orphans.includes(d));
  const computed = computeDiscounts({
    lines: openItems.map((item) => ({
      billItemId: item.id,
      totalPrice: item.totalPrice,
    })),
    discounts: live.map((d) => ({
      id: d.id,
      billItemId: d.billItemId,
      type: d.type,
      value: d.value,
    })),
  });

  for (const discount of live) {
    const amount = computed.itemAmounts.get(discount.id) ?? ZERO;

    if (!amount.eq(discount.amount)) {
      await tx.billDiscount.update({
        where: { id: discount.id },
        data: { amount },
      });
      await tx.auditLog.create({
        data: {
          restaurantId: discount.restaurantId,
          branchId: discount.branchId,
          action: 'DISCOUNT_RECALCULATED',
          entityType: 'BillDiscount',
          entityId: discount.id,
          before: { amount: discount.amount.toString() },
          after: { amount: amount.toString() },
        },
      });
    }
  }

  for (const item of items) {
    const allocation = computed.lineAllocation.get(item.id) ?? ZERO;

    if (!allocation.eq(item.discountAmount)) {
      await tx.billItem.update({
        where: { id: item.id },
        data: { discountAmount: allocation },
      });
    }
  }

  return computed.totalDiscount;
}

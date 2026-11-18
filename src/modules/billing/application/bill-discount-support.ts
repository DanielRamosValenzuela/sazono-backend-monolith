import { ConflictException, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  BillSplitParticipantStatus,
  BillSplitStatus,
  BillStatus,
} from '@prisma/client';
import { settleBillIfFullyPaid } from '../../payments/application/settle-bill-if-fully-paid';
import type {
  BillDiscountDto,
  DiscountBillTotalsDto,
} from '../presentation/http/dto/discounts.dto';
import { computeBillTotals } from '../domain/tax-policy';

export const PAYMENT_IN_PROGRESS_WINDOW_MS = 15 * 60 * 1000;

const PAYABLE_STATUSES: BillStatus[] = [
  BillStatus.OPEN,
  BillStatus.PARTIALLY_PAID,
];

export type DiscountBillRecord = {
  id: string;
  tableSessionId: string;
  branchId: string;
  status: BillStatus;
  subtotalAmount: Prisma.Decimal;
  discountAmount: Prisma.Decimal;
  tipAmount: Prisma.Decimal;
  totalAmount: Prisma.Decimal;
  remainingAmount: Prisma.Decimal;
  refundedAmount: Prisma.Decimal;
};

export async function loadDiscountBill(
  client: Prisma.TransactionClient,
  branchId: string,
  billId: string,
): Promise<DiscountBillRecord> {
  const bill = await client.bill.findFirst({ where: { id: billId, branchId } });

  if (!bill) {
    throw new NotFoundException({
      message: 'La cuenta indicada no existe en esta sucursal.',
      code: 'BILL_NOT_FOUND',
    });
  }

  return bill;
}

export function assertBillAcceptsDiscountChanges(bill: DiscountBillRecord) {
  if (!PAYABLE_STATUSES.includes(bill.status)) {
    throw new ConflictException({
      message:
        'Solo se pueden modificar descuentos de cuentas abiertas o con pago parcial.',
      code: 'DISCOUNT_BILL_NOT_PAYABLE',
    });
  }

  if (bill.refundedAmount.gt(0)) {
    throw new ConflictException({
      message:
        'La cuenta ya tiene reembolsos. Corrige con otro reembolso, no con un descuento.',
      code: 'DISCOUNT_BILL_HAS_REFUNDS',
    });
  }
}

export async function assertNoPaymentInProgress(
  client: Prisma.TransactionClient,
  billId: string,
): Promise<void> {
  const pending = await client.paymentAttempt.count({
    where: {
      billId,
      status: 'PENDING',
      createdAt: {
        gte: new Date(Date.now() - PAYMENT_IN_PROGRESS_WINDOW_MS),
      },
    },
  });

  if (pending > 0) {
    throw new ConflictException({
      message:
        'Hay un pago en curso en esta cuenta. Espera a que termine para aplicar el descuento.',
      code: 'DISCOUNT_PAYMENT_IN_PROGRESS',
    });
  }
}

export async function resolveActiveSplit(
  tx: Prisma.TransactionClient,
  billId: string,
): Promise<{ id: string } | null> {
  const split = await tx.billSplit.findFirst({
    where: {
      billId,
      status: { in: [BillSplitStatus.OPEN, BillSplitStatus.PARTIALLY_PAID] },
    },
    include: { participants: { select: { paidAmount: true } } },
  });

  if (!split) {
    return null;
  }

  if (split.participants.some((p) => p.paidAmount.gt(0))) {
    throw new ConflictException({
      message:
        'La cuenta tiene una division con pagos. No se puede cambiar el descuento.',
      code: 'DISCOUNT_BILL_HAS_ACTIVE_SPLIT',
    });
  }

  return { id: split.id };
}

export async function cancelSplit(
  tx: Prisma.TransactionClient,
  splitId: string,
): Promise<void> {
  await tx.billSplit.update({
    where: { id: splitId },
    data: { status: BillSplitStatus.CANCELLED },
  });
  await tx.billSplitParticipant.updateMany({
    where: { billSplitId: splitId },
    data: { status: BillSplitParticipantStatus.CANCELLED },
  });
}

export function paidAmountOf(bill: DiscountBillRecord): Prisma.Decimal {
  return bill.totalAmount.sub(bill.remainingAmount);
}

export async function writeBillTotals(
  tx: Prisma.TransactionClient,
  bill: DiscountBillRecord,
  discountAmount: Prisma.Decimal,
): Promise<DiscountBillRecord> {
  const paid = paidAmountOf(bill);
  const { taxAmount, totalAmount } = computeBillTotals(
    bill.subtotalAmount,
    bill.tipAmount,
    discountAmount,
  );
  const remainingAmount = totalAmount.sub(paid);
  const status = remainingAmount.lte(0)
    ? BillStatus.PAID
    : paid.lte(0)
      ? BillStatus.OPEN
      : BillStatus.PARTIALLY_PAID;
  const updated = await tx.bill.update({
    where: { id: bill.id },
    data: { discountAmount, taxAmount, totalAmount, remainingAmount, status },
  });

  if (status === BillStatus.PAID) {
    await settleBillIfFullyPaid(tx, bill);
  }

  return updated;
}

export function mapBillTotals(bill: DiscountBillRecord): DiscountBillTotalsDto {
  return {
    billId: bill.id,
    status: bill.status,
    subtotalAmount: bill.subtotalAmount.toString(),
    discountAmount: bill.discountAmount.toString(),
    consumptionAmount: bill.subtotalAmount.sub(bill.discountAmount).toString(),
    tipAmount: bill.tipAmount.toString(),
    totalAmount: bill.totalAmount.toString(),
    paidAmount: paidAmountOf(bill).toString(),
    remainingAmount: bill.remainingAmount.toString(),
  };
}

export const DISCOUNT_INCLUDE = {
  billItem: { select: { description: true } },
  appliedBy: { select: { firstName: true, lastName: true } },
  approvedBy: { select: { firstName: true, lastName: true } },
  voidedBy: { select: { firstName: true, lastName: true } },
} satisfies Prisma.BillDiscountInclude;

export type DiscountRecord = Prisma.BillDiscountGetPayload<{
  include: typeof DISCOUNT_INCLUDE;
}>;

const fullName = (user: { firstName: string; lastName: string } | null) =>
  user ? `${user.firstName} ${user.lastName}`.trim() : null;

export function mapDiscount(record: DiscountRecord): BillDiscountDto {
  return {
    id: record.id,
    billId: record.billId,
    billItemId: record.billItemId,
    billItemDescription: record.billItem?.description ?? null,
    type: record.type,
    value: record.value.toString(),
    amount: record.amount.toString(),
    reasonCode: record.reasonCode,
    reasonText: record.reasonText,
    appliedByStaffUserId: record.appliedByStaffUserId,
    appliedByName: fullName(record.appliedBy) ?? '',
    appliedByRole: record.appliedByRole,
    approvedByStaffUserId: record.approvedByStaffUserId,
    approvedByName: fullName(record.approvedBy),
    voidedAt: record.voidedAt?.toISOString() ?? null,
    voidedByStaffUserId: record.voidedByStaffUserId,
    voidedByName: fullName(record.voidedBy),
    voidReason: record.voidReason,
    createdAt: record.createdAt.toISOString(),
  };
}

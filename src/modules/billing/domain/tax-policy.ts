import { Prisma } from '@prisma/client';
export const TAX_INCLUDED_IN_PRICE = true;

export type BillTotals = {
  taxAmount: Prisma.Decimal;
  totalAmount: Prisma.Decimal;
};

export function computeBillTotals(
  subtotalAmount: Prisma.Decimal,
  tipAmount: Prisma.Decimal,
): BillTotals {
  const taxAmount = new Prisma.Decimal(0);

  return {
    taxAmount,
    totalAmount: subtotalAmount.add(tipAmount).add(taxAmount),
  };
}

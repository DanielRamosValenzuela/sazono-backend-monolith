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

export const VAT_RATE = new Prisma.Decimal('0.19');
const VAT_DIVISOR = VAT_RATE.add(1);

export type VatBreakdown = {
  netAmount: Prisma.Decimal;
  vatAmount: Prisma.Decimal;
  exemptAmount: Prisma.Decimal;
};

export function computeVatBreakdown(consumption: Prisma.Decimal): VatBreakdown {
  const netAmount = consumption
    .div(VAT_DIVISOR)
    .toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP);

  return {
    netAmount,
    vatAmount: consumption.sub(netAmount),
    exemptAmount: new Prisma.Decimal(0),
  };
}

export function computeSaleBreakdown(
  collected: Prisma.Decimal,
  tip: Prisma.Decimal,
): VatBreakdown & { tipAmount: Prisma.Decimal; totalAmount: Prisma.Decimal } {
  return {
    ...computeVatBreakdown(collected.sub(tip)),
    tipAmount: tip,
    totalAmount: collected,
  };
}

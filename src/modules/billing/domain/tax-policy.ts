import { Prisma } from '@prisma/client';

/**
 * Politica tributaria del MVP.
 *
 * Los precios de carta ya incluyen el impuesto local (IVA en Chile), por lo
 * que la cuenta no agrega impuesto sobre el subtotal y `taxAmount` queda en 0
 * como campo informativo.
 *
 * Cuando Sazono opere en paises con otra regla (impuesto agregado sobre el
 * precio o desglose obligatorio), esa variacion debe resolverse aqui, sin
 * tocar los casos de uso de ordenes ni de pagos.
 */
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

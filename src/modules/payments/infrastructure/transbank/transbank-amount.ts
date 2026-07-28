import type { Prisma } from '@prisma/client';

export const TRANSBANK_AMOUNT_DOCS_URL =
  'https://www.transbankdevelopers.cl/documentacion/como_empezar#ambientes';

export function toTransbankAmount(
  amount: Prisma.Decimal,
  currency: string,
): number {
  if (!amount.isFinite() || amount.isNaN()) {
    throw new Error('El monto a cobrar no es un numero valido.');
  }

  if (amount.lte(0)) {
    throw new Error('El monto a cobrar debe ser mayor a cero.');
  }

  if (currency !== 'CLP') {
    throw new Error(
      `Transbank Webpay solo admite pagos en CLP, se recibio ${currency}.`,
    );
  }

  if (!amount.isInteger()) {
    throw new Error('El monto a cobrar en CLP no admite decimales.');
  }

  return amount.toNumber();
}

import type { Prisma } from '@prisma/client';

export const MERCADOPAGO_CURRENCY_DOCS_URL =
  'https://www.mercadopago.com.ar/developers/en/reference/currencies/_currency_id/get';

const ZERO_DECIMAL_CURRENCIES = new Set(['CLP']);
const DEFAULT_DECIMAL_PLACES = 2;

export function toGatewayAmount(
  amount: Prisma.Decimal,
  currency: string,
): number {
  if (!amount.isFinite() || amount.isNaN()) {
    throw new Error('El monto a cobrar no es un numero valido.');
  }

  if (amount.lte(0)) {
    throw new Error('El monto a cobrar debe ser mayor a cero.');
  }

  if (ZERO_DECIMAL_CURRENCIES.has(currency)) {
    if (!amount.isInteger()) {
      throw new Error(`El monto a cobrar en ${currency} no admite decimales.`);
    }

    return amount.toNumber();
  }

  return amount.toDecimalPlaces(DEFAULT_DECIMAL_PLACES).toNumber();
}

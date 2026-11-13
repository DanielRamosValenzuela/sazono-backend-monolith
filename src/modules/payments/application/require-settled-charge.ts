import { ConflictException } from '@nestjs/common';
import { assertNever } from '../domain/assert-never';
import type { ChargePaymentResult } from './charge-payment.service';

export const PAYMENT_IN_REVIEW_MESSAGE =
  'El pago esta en revision con el proveedor. No lo repitas: se confirmara automaticamente en unos minutos.';

export const PAYMENT_IN_REVIEW_CODE = 'PAYMENT_IN_REVIEW';

export const PAYMENT_IN_REVIEW_BODY = {
  message: PAYMENT_IN_REVIEW_MESSAGE,
  code: PAYMENT_IN_REVIEW_CODE,
};

const REDIRECT_NOT_SUPPORTED_FAILURE_REASON =
  'Esta pasarela de pago requiere redireccion del cliente y todavia no esta soportada en este flujo de pago.';

export type SettledChargePaymentResult = Extract<
  ChargePaymentResult,
  { kind: 'SETTLED' }
>;

export function requireSettledCharge(
  result: ChargePaymentResult,
): SettledChargePaymentResult {
  switch (result.kind) {
    case 'SETTLED':
      return result;
    case 'PENDING':
      throw new ConflictException(PAYMENT_IN_REVIEW_BODY);
    case 'REDIRECT':
      throw new ConflictException(REDIRECT_NOT_SUPPORTED_FAILURE_REASON);
    default:
      return assertNever(result);
  }
}

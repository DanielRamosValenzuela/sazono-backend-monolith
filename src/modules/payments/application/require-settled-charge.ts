import { ConflictException } from '@nestjs/common';
import { assertNever } from '../domain/assert-never';
import type { ChargePaymentResult } from './charge-payment.service';

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
    case 'REDIRECT':
      throw new ConflictException(REDIRECT_NOT_SUPPORTED_FAILURE_REASON);
    default:
      return assertNever(result);
  }
}

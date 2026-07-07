import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import type {
  PaymentChargeInput,
  PaymentChargeResult,
  PaymentProviderPort,
} from '../application/ports/payment-provider.port';

/**
 * Adapter de pago manual del MVP: aprueba el cobro de inmediato.
 *
 * Representa el pago validado en el punto de venta (efectivo o tarjeta en
 * caja) y sirve de doble de una pasarela real mientras no exista
 * integracion externa.
 */
@Injectable()
export class ManualPaymentProviderAdapter implements PaymentProviderPort {
  readonly providerName = 'MANUAL';

  charge(input: PaymentChargeInput): Promise<PaymentChargeResult> {
    void input;

    return Promise.resolve({
      approved: true,
      providerReference: `manual-${randomUUID()}`,
    });
  }
}

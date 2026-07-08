import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import type {
  PaymentChargeInput,
  PaymentChargeResult,
  PaymentProviderPort,
} from '../application/ports/payment-provider.port';
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

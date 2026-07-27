import { BadRequestException } from '@nestjs/common';
import type { ChargePaymentCheckout } from './charge-payment.service';

export type CheckoutCapableDto = {
  cardToken?: string;
  paymentMethodId?: string;
  issuerId?: string;
  installments?: number;
  payerEmail?: string;
};

export function buildCheckoutFromDto(
  dto: CheckoutCapableDto,
): ChargePaymentCheckout | undefined {
  if (!dto.cardToken) {
    return undefined;
  }

  if (!dto.paymentMethodId || dto.installments === undefined) {
    throw new BadRequestException(
      'Para pagar con tarjeta debes enviar paymentMethodId e installments junto al cardToken.',
    );
  }

  return {
    cardToken: dto.cardToken,
    paymentMethodId: dto.paymentMethodId,
    installments: dto.installments,
    issuerId: dto.issuerId,
    payerEmail: dto.payerEmail,
  };
}

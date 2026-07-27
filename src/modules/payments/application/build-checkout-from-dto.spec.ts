import { BadRequestException } from '@nestjs/common';
import { buildCheckoutFromDto } from './build-checkout-from-dto';

describe('buildCheckoutFromDto', () => {
  it('returns undefined when no cardToken was submitted', () => {
    expect(
      buildCheckoutFromDto({ tipAmount: '1000' } as never),
    ).toBeUndefined();
  });

  it('builds a checkout payload when cardToken, paymentMethodId and installments are present', () => {
    expect(
      buildCheckoutFromDto({
        cardToken: 'card-token-1',
        paymentMethodId: 'visa',
        installments: 3,
        issuerId: '25',
        payerEmail: 'cliente@correo.cl',
      }),
    ).toEqual({
      cardToken: 'card-token-1',
      paymentMethodId: 'visa',
      installments: 3,
      issuerId: '25',
      payerEmail: 'cliente@correo.cl',
    });
  });

  it('throws when cardToken is present but paymentMethodId is missing', () => {
    expect(() =>
      buildCheckoutFromDto({ cardToken: 'card-token-1', installments: 1 }),
    ).toThrow(BadRequestException);
  });

  it('throws when cardToken is present but installments is missing', () => {
    expect(() =>
      buildCheckoutFromDto({
        cardToken: 'card-token-1',
        paymentMethodId: 'visa',
      }),
    ).toThrow(BadRequestException);
  });
});

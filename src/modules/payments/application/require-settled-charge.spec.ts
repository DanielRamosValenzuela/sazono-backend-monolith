import { ConflictException } from '@nestjs/common';
import { requireSettledCharge } from './require-settled-charge';
import type { ChargePaymentResult } from './charge-payment.service';

describe('requireSettledCharge', () => {
  it('returns the result unchanged when it is SETTLED', () => {
    const settled: ChargePaymentResult = {
      kind: 'SETTLED',
      approved: true,
      providerName: 'MERCADO_PAGO',
      providerReference: 'mp-1',
    };

    expect(requireSettledCharge(settled)).toBe(settled);
  });

  it('throws a ConflictException instead of silently treating a REDIRECT outcome as approved or rejected', () => {
    const redirect: ChargePaymentResult = {
      kind: 'REDIRECT',
      providerName: 'TRANSBANK',
      providerReference: 'tbk-1',
      redirectUrl: 'https://webpay.example/init',
      method: 'POST',
      fields: { token_ws: 'abc' },
      expiresAt: new Date('2026-07-27T12:00:00.000Z'),
    };

    expect(() => requireSettledCharge(redirect)).toThrow(ConflictException);
  });
});

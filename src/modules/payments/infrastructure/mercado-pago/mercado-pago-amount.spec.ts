import { Prisma } from '@prisma/client';
import { toGatewayAmount } from './mercado-pago-amount';

describe('toGatewayAmount', () => {
  it('returns the integer amount unchanged for CLP', () => {
    expect(toGatewayAmount(new Prisma.Decimal(11800), 'CLP')).toBe(11800);
  });

  it('throws when a CLP amount has decimals', () => {
    expect(() =>
      toGatewayAmount(new Prisma.Decimal('11800.50'), 'CLP'),
    ).toThrow('El monto a cobrar en CLP no admite decimales.');
  });

  it('throws when the amount is zero', () => {
    expect(() => toGatewayAmount(new Prisma.Decimal(0), 'CLP')).toThrow(
      'El monto a cobrar debe ser mayor a cero.',
    );
  });

  it('throws when the amount is negative', () => {
    expect(() => toGatewayAmount(new Prisma.Decimal(-100), 'CLP')).toThrow(
      'El monto a cobrar debe ser mayor a cero.',
    );
  });

  it('rounds non zero-decimal currencies to two decimal places', () => {
    expect(toGatewayAmount(new Prisma.Decimal('11800.505'), 'USD')).toBe(
      11800.51,
    );
  });
});

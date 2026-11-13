import { Prisma } from '@prisma/client';
import {
  toGatewayAmount,
  toMarketplaceFee,
  toOrderAmount,
} from './mercado-pago-amount';

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

describe('toOrderAmount', () => {
  it('returns an integer string for CLP', () => {
    expect(toOrderAmount(new Prisma.Decimal(11800), 'CLP')).toBe('11800');
  });

  it('returns two decimals for other currencies', () => {
    expect(toOrderAmount(new Prisma.Decimal('10.5'), 'USD')).toBe('10.50');
  });

  it('throws for CLP decimals', () => {
    expect(() => toOrderAmount(new Prisma.Decimal('1.5'), 'CLP')).toThrow(
      'El monto a cobrar en CLP no admite decimales.',
    );
  });
});

describe('toMarketplaceFee', () => {
  it('computes 1% of CLP as an integer string', () => {
    expect(toMarketplaceFee(new Prisma.Decimal(11800), 'CLP', 100)).toBe('118');
  });

  it('floors the fee', () => {
    expect(toMarketplaceFee(new Prisma.Decimal(11850), 'CLP', 100)).toBe('118');
  });

  it('omits the fee when bps is zero', () => {
    expect(
      toMarketplaceFee(new Prisma.Decimal(11800), 'CLP', 0),
    ).toBeUndefined();
  });

  it('omits the fee when it floors to zero', () => {
    expect(
      toMarketplaceFee(new Prisma.Decimal(50), 'CLP', 100),
    ).toBeUndefined();
  });

  it('keeps two decimals for other currencies', () => {
    expect(toMarketplaceFee(new Prisma.Decimal('10.55'), 'USD', 100)).toBe(
      '0.10',
    );
  });
});

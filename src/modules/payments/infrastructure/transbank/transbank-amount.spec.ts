import { Prisma } from '@prisma/client';
import { toTransbankAmount } from './transbank-amount';

describe('toTransbankAmount', () => {
  it('returns the integer amount unchanged for CLP', () => {
    expect(toTransbankAmount(new Prisma.Decimal(11800), 'CLP')).toBe(11800);
  });

  it('throws when a CLP amount has decimals', () => {
    expect(() =>
      toTransbankAmount(new Prisma.Decimal('11800.50'), 'CLP'),
    ).toThrow('El monto a cobrar en CLP no admite decimales.');
  });

  it('throws when the amount is zero', () => {
    expect(() => toTransbankAmount(new Prisma.Decimal(0), 'CLP')).toThrow(
      'El monto a cobrar debe ser mayor a cero.',
    );
  });

  it('throws when the amount is negative', () => {
    expect(() => toTransbankAmount(new Prisma.Decimal(-100), 'CLP')).toThrow(
      'El monto a cobrar debe ser mayor a cero.',
    );
  });

  it('throws for a currency other than CLP', () => {
    expect(() => toTransbankAmount(new Prisma.Decimal(100), 'USD')).toThrow(
      'Transbank Webpay solo admite pagos en CLP, se recibio USD.',
    );
  });
});

import { Prisma } from '@prisma/client';
import { computeRefundNet } from '../../payments/domain/refund-amounts';
import {
  computeSaleBreakdown,
  computeVatBreakdown,
  VAT_RATE,
} from './tax-policy';

const d = (value: string | number) => new Prisma.Decimal(value);

describe('tax-policy VAT', () => {
  it('exposes the 19 percent rate', () => {
    expect(VAT_RATE.toString()).toBe('0.19');
  });

  it('splits 11.900 into net 10.000 and vat 1.900', () => {
    const result = computeVatBreakdown(d(11900));

    expect(result.netAmount.toString()).toBe('10000');
    expect(result.vatAmount.toString()).toBe('1900');
    expect(result.exemptAmount.toString()).toBe('0');
  });

  it('keeps the tip out of net and vat', () => {
    const result = computeSaleBreakdown(d(13090), d(1190));

    expect(result.netAmount.toString()).toBe('10000');
    expect(result.vatAmount.toString()).toBe('1900');
    expect(result.tipAmount.toString()).toBe('1190');
    expect(
      result.netAmount.add(result.vatAmount).add(result.tipAmount).eq(13090),
    ).toBe(true);
  });

  it('always satisfies net + vat = consumption', () => {
    for (const value of [1, 99, 1000, 4990, 12345, 99999]) {
      const result = computeVatBreakdown(d(value));

      expect(result.netAmount.add(result.vatAmount).eq(value)).toBe(true);
    }
  });

  it('matches computeRefundNet for a full first refund', () => {
    const refund = computeRefundNet(d(0), d(11900));
    const sale = computeVatBreakdown(d(11900));

    expect(refund.netAmount.eq(sale.netAmount)).toBe(true);
    expect(refund.vatAmount.eq(sale.vatAmount)).toBe(true);
  });
});

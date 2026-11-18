import { Prisma } from '@prisma/client';
import {
  computeDiscounts,
  maxDiscount,
  requiresApproval,
} from './discount-policy';
import { computeBillTotals } from './tax-policy';

const d = (value: string | number) => new Prisma.Decimal(value);
const line = (billItemId: string, totalPrice: number) => ({
  billItemId,
  totalPrice: d(totalPrice),
});

describe('computeBillTotals with discount', () => {
  it('behaves as before without the third argument', () => {
    const result = computeBillTotals(d(21000), d(2100));

    expect(result.totalAmount.toString()).toBe('23100');
    expect(result.discountAmount.toString()).toBe('0');
    expect(result.consumptionAmount.toString()).toBe('21000');
  });

  it('subtracts the discount from consumption and keeps the tip', () => {
    const result = computeBillTotals(d(21000), d(2100), d(2100));

    expect(result.consumptionAmount.toString()).toBe('18900');
    expect(result.totalAmount.toString()).toBe('21000');
  });

  it('clips a discount larger than the subtotal', () => {
    const result = computeBillTotals(d(1000), d(100), d(5000));

    expect(result.discountAmount.toString()).toBe('1000');
    expect(result.totalAmount.toString()).toBe('100');
  });
});

describe('computeDiscounts', () => {
  it('rounds percent half up once over the base', () => {
    const result = computeDiscounts({
      lines: [line('a', 19), line('b', 0)],
      discounts: [{ id: 'x', billItemId: null, type: 'PERCENT', value: d(50) }],
    });

    expect(result.billAmount.toString()).toBe('10');
  });

  it('clips an amount discount to the base', () => {
    const result = computeDiscounts({
      lines: [line('a', 3000)],
      discounts: [
        { id: 'x', billItemId: null, type: 'AMOUNT', value: d(9000) },
      ],
    });

    expect(result.totalDiscount.toString()).toBe('3000');
  });

  it('combines a line discount with a bill discount over the remaining base', () => {
    const result = computeDiscounts({
      lines: [line('a', 18000), line('b', 3000)],
      discounts: [
        { id: 'l', billItemId: 'a', type: 'PERCENT', value: d(50) },
        { id: 'c', billItemId: null, type: 'PERCENT', value: d(10) },
      ],
    });

    expect(result.itemAmounts.get('l')?.toString()).toBe('9000');
    expect(result.itemAmounts.get('c')?.toString()).toBe('1200');
    expect(result.totalDiscount.toString()).toBe('10200');
  });

  it('allocates the bill discount by largest remainder so the sum is exact', () => {
    const result = computeDiscounts({
      lines: [line('a', 1000), line('b', 1000), line('c', 1000)],
      discounts: [{ id: 'x', billItemId: null, type: 'AMOUNT', value: d(100) }],
    });
    const parts = [...result.lineAllocation.values()].map((v) => v.toString());
    const sum = [...result.lineAllocation.values()].reduce(
      (total, value) => total.add(value),
      d(0),
    );

    expect(sum.toString()).toBe('100');
    expect(parts.sort()).toEqual(['33', '33', '34']);
  });

  it('ignores a line discount whose line is gone', () => {
    const result = computeDiscounts({
      lines: [line('a', 1000)],
      discounts: [
        { id: 'l', billItemId: 'gone', type: 'AMOUNT', value: d(500) },
      ],
    });

    expect(result.itemAmounts.get('l')?.toString()).toBe('0');
    expect(result.totalDiscount.toString()).toBe('0');
  });

  it('allows a 100 percent courtesy', () => {
    const result = computeDiscounts({
      lines: [line('a', 7000), line('b', 3000)],
      discounts: [
        { id: 'x', billItemId: null, type: 'PERCENT', value: d(100) },
      ],
    });

    expect(result.totalDiscount.toString()).toBe('10000');
    expect(result.lineAllocation.get('a')?.toString()).toBe('7000');
  });
});

describe('maxDiscount', () => {
  it('is subtotal plus tip minus paid', () => {
    expect(maxDiscount(d(21000), d(2100), d(10000)).toString()).toBe('13100');
  });

  it('never goes negative', () => {
    expect(maxDiscount(d(1000), d(0), d(5000)).toString()).toBe('0');
  });
});

describe('requiresApproval', () => {
  const thresholds = { percent: d(10), amount: null };

  it('does not need approval under the percent threshold', () => {
    expect(
      requiresApproval({
        isAdmin: false,
        subtotal: d(10000),
        totalDiscount: d(1000),
        thresholds,
      }),
    ).toBe(false);
  });

  it('needs approval above the percent threshold', () => {
    expect(
      requiresApproval({
        isAdmin: false,
        subtotal: d(10000),
        totalDiscount: d(1001),
        thresholds,
      }),
    ).toBe(true);
  });

  it('needs approval above the amount threshold', () => {
    expect(
      requiresApproval({
        isAdmin: false,
        subtotal: d(100000),
        totalDiscount: d(6000),
        thresholds: { percent: null, amount: d(5000) },
      }),
    ).toBe(true);
  });

  it('never needs approval for an admin', () => {
    expect(
      requiresApproval({
        isAdmin: true,
        subtotal: d(10000),
        totalDiscount: d(10000),
        thresholds,
      }),
    ).toBe(false);
  });

  it('always needs approval for a full courtesy even without thresholds', () => {
    expect(
      requiresApproval({
        isAdmin: false,
        subtotal: d(10000),
        totalDiscount: d(10000),
        thresholds: { percent: null, amount: null },
      }),
    ).toBe(true);
  });
});

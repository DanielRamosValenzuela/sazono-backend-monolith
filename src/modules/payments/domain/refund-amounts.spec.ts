import { Prisma } from '@prisma/client';
import {
  computeRefundBreakdown,
  computeRefundNet,
  computeRefundable,
  type RefundablePayment,
} from './refund-amounts';

const d = (value: number | string) => new Prisma.Decimal(value);

const payment = (
  amount: number | string,
  tip: number | string,
  refunded: number | string = 0,
  refundedTip: number | string = 0,
): RefundablePayment => ({
  amount: d(amount),
  tipAmount: d(tip),
  refundedAmount: d(refunded),
  refundedTipAmount: d(refundedTip),
});

const breakdown = (
  pay: RefundablePayment,
  amount: number | string,
  refundTip: boolean,
  tipAmount?: number | string,
) =>
  computeRefundBreakdown(pay, {
    amount: d(amount),
    refundTip,
    tipAmount: tipAmount === undefined ? undefined : d(tipAmount),
  });

const okBreakdown = (result: ReturnType<typeof breakdown>) => {
  if (!result.ok) {
    throw new Error(`unexpected failure ${result.code}: ${result.message}`);
  }

  return {
    amount: result.breakdown.amount.toString(),
    tip: result.breakdown.tipAmount.toString(),
    consumption: result.breakdown.consumptionAmount.toString(),
  };
};

describe('computeRefundable', () => {
  it('splits the remaining total into consumption and tip', () => {
    const refundable = computeRefundable(payment(11000, 1000, 3500, 500));

    expect(refundable.total.toString()).toBe('7500');
    expect(refundable.consumption.toString()).toBe('7000');
    expect(refundable.tip.toString()).toBe('500');
  });
});

describe('computeRefundBreakdown', () => {
  it('refunds consumption only by default', () => {
    expect(okBreakdown(breakdown(payment(11000, 1000), 3000, false))).toEqual({
      amount: '3000',
      tip: '0',
      consumption: '3000',
    });
  });

  it('computes the proportional tip with the original ratio when nothing was refunded', () => {
    expect(okBreakdown(breakdown(payment(11000, 1000), 3000, true))).toEqual({
      amount: '3000',
      tip: '273',
      consumption: '2727',
    });
  });

  it('uses the ratio of what remains after consumption-only refunds', () => {
    const pay = payment(11000, 1000, 9000, 0);

    expect(okBreakdown(breakdown(pay, 1999, true))).toEqual({
      amount: '1999',
      tip: '1000',
      consumption: '999',
    });
  });

  it('gives all-tip when the remaining consumption is zero', () => {
    const pay = payment(11000, 1000, 10000, 0);

    expect(okBreakdown(breakdown(pay, 400, true))).toEqual({
      amount: '400',
      tip: '400',
      consumption: '0',
    });
  });

  it('empties the payment with the exact tip', () => {
    expect(okBreakdown(breakdown(payment(11000, 1000), 11000, true))).toEqual({
      amount: '11000',
      tip: '1000',
      consumption: '10000',
    });
  });

  it('can empty a payment with decimals', () => {
    const pay = payment('11000.50', '1000.50');

    expect(okBreakdown(breakdown(pay, '11000.50', true))).toEqual({
      amount: '11000.5',
      tip: '1000.5',
      consumption: '10000',
    });
  });

  it('accepts an explicit editable tip', () => {
    expect(
      okBreakdown(breakdown(payment(11000, 1000), 3000, true, 500)),
    ).toEqual({ amount: '3000', tip: '500', consumption: '2500' });
  });

  it('rejects an explicit tip without refundTip', () => {
    const result = breakdown(payment(11000, 1000), 3000, false, 500);

    expect(result).toMatchObject({ ok: false, code: 'REFUND_TIP_NOT_ALLOWED' });
  });

  it('rejects a tip above the remaining tip', () => {
    const result = breakdown(payment(11000, 1000, 0, 800), 3000, true, 500);

    expect(result).toMatchObject({
      ok: false,
      code: 'REFUND_EXCEEDS_REFUNDABLE',
    });
    expect((result as { message: string }).message).toContain('propina');
  });

  it('rejects a tip above the amount', () => {
    const result = breakdown(payment(11000, 1000), 300, true, 500);

    expect(result).toMatchObject({
      ok: false,
      code: 'REFUND_EXCEEDS_REFUNDABLE',
    });
  });

  it('rejects an amount above the total and reports what is refundable', () => {
    const result = breakdown(payment(11000, 1000, 3000), 8001, false);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('REFUND_EXCEEDS_REFUNDABLE');
      expect(result.refundable.total.toString()).toBe('8000');
      expect(result.refundable.consumption.toString()).toBe('7000');
      expect(result.refundable.tip.toString()).toBe('1000');
    }
  });

  it('rejects consumption above the remaining consumption even when the total fits', () => {
    const result = breakdown(payment(11000, 1000, 3000), 7500, false);

    expect(result).toMatchObject({
      ok: false,
      code: 'REFUND_EXCEEDS_REFUNDABLE',
    });
    expect((result as { message: string }).message).toContain(
      'Reembolsar propina',
    );
  });

  it('explains the explicit-tip variant when consumption does not fit', () => {
    const result = breakdown(payment(11000, 1000, 3000), 7500, true, 100);

    expect((result as { message: string }).message).toContain(
      'sube la propina',
    );
  });

  it('accepts exactly the remaining consumption without tip', () => {
    expect(
      okBreakdown(breakdown(payment(11000, 1000, 3000), 7000, false)),
    ).toEqual({ amount: '7000', tip: '0', consumption: '7000' });
  });
});

describe('computeRefundNet', () => {
  const split = (before: number, consumption: number) => {
    const { netAmount, vatAmount } = computeRefundNet(
      d(before),
      d(consumption),
    );
    return { net: netAmount.toNumber(), vat: vatAmount.toNumber() };
  };

  it('splits a first refund', () => {
    expect(split(0, 3000)).toEqual({ net: 2521, vat: 479 });
    expect(split(0, 11900)).toEqual({ net: 10000, vat: 1900 });
    expect(split(0, 1)).toEqual({ net: 1, vat: 0 });
  });

  it('is zero for a tip-only refund', () => {
    expect(split(0, 0)).toEqual({ net: 0, vat: 0 });
  });

  it('adds up to the original breakdown across 10000 one-peso refunds', () => {
    let before = 0;
    let net = 0;
    let vat = 0;

    for (let index = 0; index < 10000; index++) {
      const part = split(before, 1);
      net += part.net;
      vat += part.vat;
      before += 1;
    }

    expect(net).toBe(8403);
    expect(vat).toBe(1597);
  });

  it('adds up across 3333 + 3333 + 3334', () => {
    const first = split(0, 3333);
    const second = split(3333, 3333);
    const third = split(6666, 3334);

    expect(first.net + second.net + third.net).toBe(8403);
  });

  it('keeps the net between 0 and the consumption for integer amounts', () => {
    for (const before of [0, 1, 2, 118, 119, 120, 5000]) {
      for (const consumption of [1, 2, 3, 10, 119, 1000]) {
        const { net, vat } = split(before, consumption);
        expect(net).toBeGreaterThanOrEqual(0);
        expect(net).toBeLessThanOrEqual(consumption);
        expect(net + vat).toBe(consumption);
      }
    }
  });

  it('rounds half up', () => {
    expect(split(0, 238)).toEqual({ net: 200, vat: 38 });
    expect(split(0, 2)).toEqual({ net: 2, vat: 0 });
    expect(split(1, 1)).toEqual({ net: 1, vat: 0 });
  });
});

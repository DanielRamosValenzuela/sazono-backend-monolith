import { Prisma } from '@prisma/client';
import { computeLineRefundAmount } from './refund-items';

const d = (value: number) => new Prisma.Decimal(value);

describe('computeLineRefundAmount', () => {
  it('prorates a partial quantity half up', () => {
    expect(
      computeLineRefundAmount({
        quantity: 3,
        refundedQuantity: 0,
        netAmount: d(10000),
        refundedAmount: d(0),
        requested: 1,
      }).toString(),
    ).toBe('3333');
  });

  it('closes the last unit without losing pesos', () => {
    expect(
      computeLineRefundAmount({
        quantity: 3,
        refundedQuantity: 2,
        netAmount: d(10000),
        refundedAmount: d(6667),
        requested: 1,
      }).toString(),
    ).toBe('3333');
  });

  it('refunds the whole discounted line when all units are requested', () => {
    expect(
      computeLineRefundAmount({
        quantity: 2,
        refundedQuantity: 0,
        netAmount: d(16200),
        refundedAmount: d(0),
        requested: 2,
      }).toString(),
    ).toBe('16200');
  });

  it('never exceeds what is left of the line', () => {
    expect(
      computeLineRefundAmount({
        quantity: 4,
        refundedQuantity: 3,
        netAmount: d(1000),
        refundedAmount: d(900),
        requested: 1,
      }).toString(),
    ).toBe('100');
  });
});

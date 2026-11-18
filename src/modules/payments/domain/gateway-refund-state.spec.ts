import { Prisma } from '@prisma/client';
import { resolveRemoteRefundState } from './gateway-refund-state';

const d = (value: number) => new Prisma.Decimal(value);

describe('resolveRemoteRefundState', () => {
  const refunds = [
    { reference: 'R1', amount: '3000', outcome: 'APPROVED' as const },
  ];

  it('detects a processed refund when prior manual refunds are not counted', () => {
    expect(
      resolveRemoteRefundState({
        refunds,
        alreadyRefundedAmount: d(0),
        amount: d(3000),
      }),
    ).toEqual({ kind: 'REFUNDED', providerRefundReference: 'R1' });
  });

  it('would misclassify it if a manual refund inflated the already refunded amount', () => {
    expect(
      resolveRemoteRefundState({
        refunds,
        alreadyRefundedAmount: d(3000),
        amount: d(3000),
      }).kind,
    ).toBe('NOT_REFUNDED');
  });
});

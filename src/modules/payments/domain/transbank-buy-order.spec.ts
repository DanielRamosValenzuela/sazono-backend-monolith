import {
  TRANSBANK_BUY_ORDER_MAX_LENGTH,
  buildTransbankBuyOrder,
} from './transbank-buy-order';

describe('buildTransbankBuyOrder', () => {
  it('derives a buyOrder that never exceeds the 26 character Transbank limit', () => {
    const attemptId = 'c3d5f9a0-1234-4abc-9def-0123456789ab';

    const buyOrder = buildTransbankBuyOrder(attemptId);

    expect(buyOrder.length).toBe(TRANSBANK_BUY_ORDER_MAX_LENGTH);
    expect(buyOrder.length).toBeLessThanOrEqual(26);
  });

  it('is deterministic: the same attemptId always produces the same buyOrder', () => {
    const attemptId = '11111111-1111-4111-8111-111111111111';

    expect(buildTransbankBuyOrder(attemptId)).toBe(
      buildTransbankBuyOrder(attemptId),
    );
  });

  it('produces different buyOrders for different attemptIds', () => {
    const first = buildTransbankBuyOrder(
      '11111111-1111-4111-8111-111111111111',
    );
    const second = buildTransbankBuyOrder(
      '22222222-2222-4222-8222-222222222222',
    );

    expect(first).not.toBe(second);
  });

  it('handles a short attemptId the same way as a full UUID', () => {
    const buyOrder = buildTransbankBuyOrder('short-id');

    expect(buyOrder.length).toBe(TRANSBANK_BUY_ORDER_MAX_LENGTH);
  });

  it('always starts with the sz- prefix so buyOrders stay easy to spot in the Transbank dashboard', () => {
    expect(buildTransbankBuyOrder('any-attempt-id')).toMatch(/^sz-/);
  });
});

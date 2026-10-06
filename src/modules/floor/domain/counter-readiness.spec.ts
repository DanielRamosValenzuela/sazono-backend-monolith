import { OrderStatus as S } from '@prisma/client';
import { rollupCounterReadiness } from './counter-readiness';

describe('rollupCounterReadiness', () => {
  it.each([
    [[], 'EMPTY'],
    [[S.CANCELLED], 'EMPTY'],
    [[S.DELIVERED, S.CANCELLED], 'DELIVERED'],
    [[S.READY, S.DELIVERED], 'READY'],
    [[S.READY, S.READY], 'READY'],
    [[S.READY, S.IN_PREPARATION], 'PARTIALLY_READY'],
    [[S.PARTIALLY_READY], 'PARTIALLY_READY'],
    [[S.DELIVERED, S.IN_PREPARATION], 'PREPARING'],
    [[S.IN_PREPARATION, S.ROUTED], 'PREPARING'],
    [[S.CONFIRMED, S.ROUTED], 'WAITING'],
    [[S.READY, S.CANCELLED], 'READY'],
  ] as [S[], string][])('%j -> %s', (statuses, expected) => {
    expect(rollupCounterReadiness(statuses)).toBe(expected);
  });
});

import { CashMovementType, Prisma } from '@prisma/client';
import {
  computeDifference,
  computeSessionFigures,
  normalizeRegisterLabel,
  signedMovementAmount,
} from './cash-expected';

describe('cash expected', () => {
  it('adds float, cash sales and every signed movement type', () => {
    const figures = computeSessionFigures(20000, 50000, [
      { type: CashMovementType.CASH_IN, amount: 3000 },
      { type: CashMovementType.CASH_OUT, amount: -5000 },
      { type: CashMovementType.REFUND_OUT, amount: -2000 },
      { type: CashMovementType.TIP_PAYOUT, amount: -1000 },
      { type: CashMovementType.ADJUSTMENT, amount: 500 },
    ]);

    expect(figures.expectedCash.toString()).toBe('65500');
    expect(figures.movements.toString()).toBe('-4500');
    expect(figures.cashOut.toString()).toBe('-5000');
    expect(figures.other.toString()).toBe('-500');
  });

  it('is just the float with no activity', () => {
    expect(computeSessionFigures(15000, 0, []).expectedCash.toString()).toBe(
      '15000',
    );
  });

  it('reports shortage as negative difference', () => {
    expect(computeDifference(64000, 65500).toString()).toBe('-1500');
    expect(computeDifference(65500, 65500).isZero()).toBe(true);
  });

  it('signs movements by type regardless of input sign', () => {
    const amount = new Prisma.Decimal(-700);

    expect(
      signedMovementAmount(CashMovementType.CASH_IN, amount).toString(),
    ).toBe('700');
    expect(
      signedMovementAmount(CashMovementType.CASH_OUT, amount).toString(),
    ).toBe('-700');
  });

  it('normalizes labels', () => {
    expect(normalizeRegisterLabel(undefined)).toBe('Caja 1');
    expect(normalizeRegisterLabel('  Barra   2 ')).toBe('Barra 2');
  });
});

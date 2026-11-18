import { CashMovementType, Prisma } from '@prisma/client';

export const MAX_REGISTER_LABEL_LENGTH = 40;
export const DEFAULT_REGISTER_LABEL = 'Caja 1';

export type CashSessionFigures = {
  openingFloat: Prisma.Decimal;
  cashSales: Prisma.Decimal;
  movements: Prisma.Decimal;
  cashIn: Prisma.Decimal;
  cashOut: Prisma.Decimal;
  refundOut: Prisma.Decimal;
  other: Prisma.Decimal;
  expectedCash: Prisma.Decimal;
};

export function normalizeRegisterLabel(raw: string | undefined): string {
  const label = (raw ?? '').trim().replace(/\s+/g, ' ');

  return label === '' ? DEFAULT_REGISTER_LABEL : label;
}

export function signedMovementAmount(
  type: CashMovementType,
  amount: Prisma.Decimal,
): Prisma.Decimal {
  const magnitude = amount.abs();

  return type === CashMovementType.CASH_IN ? magnitude : magnitude.neg();
}

export function computeSessionFigures(
  openingFloat: Prisma.Decimal.Value,
  cashSales: Prisma.Decimal.Value,
  movementsByType: Array<{
    type: CashMovementType | string;
    amount: Prisma.Decimal.Value;
  }>,
): CashSessionFigures {
  const zero = new Prisma.Decimal(0);
  let cashIn = zero;
  let cashOut = zero;
  let refundOut = zero;
  let other = zero;

  for (const movement of movementsByType) {
    const amount = new Prisma.Decimal(movement.amount);

    if (movement.type === CashMovementType.CASH_IN) {
      cashIn = cashIn.add(amount);
    } else if (movement.type === CashMovementType.CASH_OUT) {
      cashOut = cashOut.add(amount);
    } else if (movement.type === CashMovementType.REFUND_OUT) {
      refundOut = refundOut.add(amount);
    } else {
      other = other.add(amount);
    }
  }

  const movements = cashIn.add(cashOut).add(refundOut).add(other);
  const sales = new Prisma.Decimal(cashSales);
  const opening = new Prisma.Decimal(openingFloat);

  return {
    openingFloat: opening,
    cashSales: sales,
    movements,
    cashIn,
    cashOut,
    refundOut,
    other,
    expectedCash: opening.add(sales).add(movements),
  };
}

export function computeDifference(
  countedCash: Prisma.Decimal.Value,
  expectedCash: Prisma.Decimal.Value,
): Prisma.Decimal {
  return new Prisma.Decimal(countedCash).sub(expectedCash);
}

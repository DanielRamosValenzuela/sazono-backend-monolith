import { Prisma } from '@prisma/client';

const ZERO = new Prisma.Decimal(0);

export type DiscountLine = { billItemId: string; totalPrice: Prisma.Decimal };

export type DiscountRule = {
  id: string;
  billItemId: string | null;
  type: 'PERCENT' | 'AMOUNT';
  value: Prisma.Decimal;
};

export type DiscountComputation = {
  itemAmounts: Map<string, Prisma.Decimal>;
  billAmount: Prisma.Decimal;
  lineDiscountTotal: Prisma.Decimal;
  totalDiscount: Prisma.Decimal;
  lineAllocation: Map<string, Prisma.Decimal>;
};

function rawAmount(rule: DiscountRule, base: Prisma.Decimal): Prisma.Decimal {
  if (base.lte(0)) {
    return ZERO;
  }

  return rule.type === 'PERCENT'
    ? base
        .mul(rule.value)
        .div(100)
        .toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP)
    : Prisma.Decimal.min(rule.value, base);
}

function distribute(
  total: Prisma.Decimal,
  weights: Array<{ key: string; weight: Prisma.Decimal }>,
): Map<string, Prisma.Decimal> {
  const result = new Map<string, Prisma.Decimal>();
  const weightSum = weights.reduce((sum, w) => sum.add(w.weight), ZERO);

  if (total.lte(0) || weightSum.lte(0)) {
    weights.forEach((w) => result.set(w.key, ZERO));
    return result;
  }

  const parts = weights.map((w, index) => {
    const exact = total.mul(w.weight).div(weightSum);
    const floor = exact.floor();
    return { key: w.key, index, floor, rest: exact.sub(floor) };
  });
  let remainder = total.sub(parts.reduce((sum, p) => sum.add(p.floor), ZERO));
  const order = [...parts].sort((a, b) =>
    b.rest.cmp(a.rest) !== 0 ? b.rest.cmp(a.rest) : a.index - b.index,
  );
  const extra = new Set<string>();

  for (const part of order) {
    if (remainder.lte(0)) {
      break;
    }
    extra.add(part.key);
    remainder = remainder.sub(1);
  }

  parts.forEach((p) =>
    result.set(p.key, extra.has(p.key) ? p.floor.add(1) : p.floor),
  );

  return result;
}

export function computeDiscounts(input: {
  lines: DiscountLine[];
  discounts: DiscountRule[];
}): DiscountComputation {
  const itemAmounts = new Map<string, Prisma.Decimal>();
  const lineDiscount = new Map<string, Prisma.Decimal>();
  const priceByLine = new Map(
    input.lines.map((line) => [line.billItemId, line.totalPrice]),
  );

  for (const rule of input.discounts) {
    if (!rule.billItemId) {
      continue;
    }

    const price = priceByLine.get(rule.billItemId);
    const amount = price ? rawAmount(rule, price) : ZERO;
    itemAmounts.set(rule.id, amount);
    lineDiscount.set(
      rule.billItemId,
      (lineDiscount.get(rule.billItemId) ?? ZERO).add(amount),
    );
  }

  const subtotal = input.lines.reduce((sum, l) => sum.add(l.totalPrice), ZERO);
  const lineDiscountTotal = input.lines.reduce(
    (sum, l) => sum.add(lineDiscount.get(l.billItemId) ?? ZERO),
    ZERO,
  );
  const base = subtotal.sub(lineDiscountTotal);
  const billRule = input.discounts.find((rule) => !rule.billItemId);
  const billAmount = billRule ? rawAmount(billRule, base) : ZERO;

  if (billRule) {
    itemAmounts.set(billRule.id, billAmount);
  }

  const shares = distribute(
    billAmount,
    input.lines.map((l) => ({
      key: l.billItemId,
      weight: l.totalPrice.sub(lineDiscount.get(l.billItemId) ?? ZERO),
    })),
  );
  const lineAllocation = new Map<string, Prisma.Decimal>();

  for (const line of input.lines) {
    lineAllocation.set(
      line.billItemId,
      (lineDiscount.get(line.billItemId) ?? ZERO).add(
        shares.get(line.billItemId) ?? ZERO,
      ),
    );
  }

  return {
    itemAmounts,
    billAmount,
    lineDiscountTotal,
    totalDiscount: lineDiscountTotal.add(billAmount),
    lineAllocation,
  };
}

export function maxDiscount(
  subtotal: Prisma.Decimal,
  tip: Prisma.Decimal,
  paid: Prisma.Decimal,
): Prisma.Decimal {
  return Prisma.Decimal.max(subtotal.add(tip).sub(paid), ZERO);
}

export type ApprovalThresholds = {
  percent: Prisma.Decimal | null;
  amount: Prisma.Decimal | null;
};

export function requiresApproval(input: {
  isAdmin: boolean;
  subtotal: Prisma.Decimal;
  totalDiscount: Prisma.Decimal;
  thresholds: ApprovalThresholds;
}): boolean {
  if (input.isAdmin || input.totalDiscount.lte(0)) {
    return false;
  }

  if (input.totalDiscount.gte(input.subtotal)) {
    return true;
  }

  const { percent, amount } = input.thresholds;

  if (
    percent !== null &&
    input.totalDiscount.mul(100).gt(input.subtotal.mul(percent))
  ) {
    return true;
  }

  return amount !== null && input.totalDiscount.gt(amount);
}

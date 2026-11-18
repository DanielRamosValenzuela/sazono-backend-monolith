import { Prisma } from '@prisma/client';

export const VAT_DIVISOR = new Prisma.Decimal('1.19');

export type RefundablePayment = {
  amount: Prisma.Decimal;
  tipAmount: Prisma.Decimal;
  refundedAmount: Prisma.Decimal;
  refundedTipAmount: Prisma.Decimal;
};

export type Refundable = {
  total: Prisma.Decimal;
  consumption: Prisma.Decimal;
  tip: Prisma.Decimal;
};

export type RefundBreakdown = {
  amount: Prisma.Decimal;
  tipAmount: Prisma.Decimal;
  consumptionAmount: Prisma.Decimal;
};

export type RefundBreakdownResult =
  | { ok: true; breakdown: RefundBreakdown }
  | {
      ok: false;
      code: 'REFUND_EXCEEDS_REFUNDABLE' | 'REFUND_TIP_NOT_ALLOWED';
      message: string;
      refundable: Refundable;
    };

const roundHalfUp = (value: Prisma.Decimal, places: number) =>
  value.toDecimalPlaces(places, Prisma.Decimal.ROUND_HALF_UP);

const money = (value: Prisma.Decimal) =>
  value.toFixed(value.isInteger() ? 0 : 2);

export function computeRefundable(payment: RefundablePayment): Refundable {
  return {
    total: payment.amount.sub(payment.refundedAmount),
    consumption: payment.amount
      .sub(payment.tipAmount)
      .sub(payment.refundedAmount.sub(payment.refundedTipAmount)),
    tip: payment.tipAmount.sub(payment.refundedTipAmount),
  };
}

export function computeRefundBreakdown(
  payment: RefundablePayment,
  input: {
    amount: Prisma.Decimal;
    refundTip: boolean;
    tipAmount?: Prisma.Decimal;
  },
): RefundBreakdownResult {
  const refundable = computeRefundable(payment);
  const fail = (
    code: 'REFUND_EXCEEDS_REFUNDABLE' | 'REFUND_TIP_NOT_ALLOWED',
    message: string,
  ): RefundBreakdownResult => ({ ok: false, code, message, refundable });

  if (input.amount.gt(refundable.total)) {
    return fail(
      'REFUND_EXCEEDS_REFUNDABLE',
      `El monto supera lo reembolsable de este pago (maximo ${money(refundable.total)} en total).`,
    );
  }

  if (input.tipAmount !== undefined && !input.refundTip) {
    return fail(
      'REFUND_TIP_NOT_ALLOWED',
      'Para devolver propina marca "Reembolsar propina".',
    );
  }

  let tip = new Prisma.Decimal(0);

  if (input.refundTip && input.tipAmount !== undefined) {
    tip = input.tipAmount;
  } else if (input.refundTip) {
    if (input.amount.eq(refundable.total)) {
      tip = refundable.tip;
    } else if (refundable.total.gt(0)) {
      const proportional = roundHalfUp(
        input.amount.mul(refundable.tip).div(refundable.total),
        0,
      );
      tip = Prisma.Decimal.min(refundable.tip, proportional);

      if (input.amount.sub(tip).gt(refundable.consumption)) {
        tip = input.amount.sub(refundable.consumption);
      }
    }
  }

  if (tip.gt(refundable.tip)) {
    return fail(
      'REFUND_EXCEEDS_REFUNDABLE',
      `La propina supera lo disponible (${money(refundable.tip)}).`,
    );
  }

  if (tip.gt(input.amount)) {
    return fail(
      'REFUND_EXCEEDS_REFUNDABLE',
      'La propina no puede superar el monto.',
    );
  }

  const consumption = input.amount.sub(tip);

  if (consumption.gt(refundable.consumption)) {
    return fail(
      'REFUND_EXCEEDS_REFUNDABLE',
      input.refundTip
        ? `El consumo supera lo disponible (${money(refundable.consumption)}): sube la propina a devolver o baja el monto.`
        : `Para devolver mas de ${money(refundable.consumption)} de consumo marca Reembolsar propina.`,
    );
  }

  return {
    ok: true,
    breakdown: {
      amount: input.amount,
      tipAmount: tip,
      consumptionAmount: consumption,
    },
  };
}

export function computeRefundNet(
  consumptionRefundedBefore: Prisma.Decimal,
  consumptionAmount: Prisma.Decimal,
): { netAmount: Prisma.Decimal; vatAmount: Prisma.Decimal } {
  if (consumptionAmount.lte(0)) {
    return {
      netAmount: new Prisma.Decimal(0),
      vatAmount: new Prisma.Decimal(0),
    };
  }

  const netOf = (value: Prisma.Decimal) =>
    roundHalfUp(value.div(VAT_DIVISOR), 0);
  const raw = netOf(consumptionRefundedBefore.add(consumptionAmount)).sub(
    netOf(consumptionRefundedBefore),
  );
  const netAmount = Prisma.Decimal.max(
    0,
    Prisma.Decimal.min(raw, consumptionAmount),
  );

  return { netAmount, vatAmount: consumptionAmount.sub(netAmount) };
}

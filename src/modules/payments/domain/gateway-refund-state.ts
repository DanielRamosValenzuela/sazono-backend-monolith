import { Prisma } from '@prisma/client';
import type {
  GatewayRefundState,
  GatewayRemoteRefund,
} from '../application/ports/payment-gateway.port';

const APPROVED_REFUND_STATUSES = new Set([
  'approved',
  'processed',
  'refunded',
  'succeeded',
]);
const REJECTED_REFUND_STATUSES = new Set([
  'rejected',
  'failed',
  'cancelled',
  'canceled',
  'expired',
]);

export function mapRemoteRefundOutcome(
  status: string | undefined,
): GatewayRemoteRefund['outcome'] {
  const normalized = (status ?? '').toLowerCase();

  if (APPROVED_REFUND_STATUSES.has(normalized)) {
    return 'APPROVED';
  }

  return REJECTED_REFUND_STATUSES.has(normalized) ? 'REJECTED' : 'PENDING';
}

export function resolveRemoteRefundState(input: {
  refunds: GatewayRemoteRefund[];
  alreadyRefundedAmount: Prisma.Decimal;
  amount: Prisma.Decimal;
  providerRefundReference?: string | null;
}): GatewayRefundState {
  const { refunds, alreadyRefundedAmount, amount } = input;
  const own = input.providerRefundReference
    ? refunds.find(
        (refund) => refund.reference === input.providerRefundReference,
      )
    : undefined;

  if (own) {
    if (own.outcome === 'APPROVED') {
      return { kind: 'REFUNDED', providerRefundReference: own.reference };
    }

    return own.outcome === 'PENDING'
      ? { kind: 'PENDING' }
      : { kind: 'NOT_REFUNDED' };
  }

  const sum = (outcome: GatewayRemoteRefund['outcome']) =>
    refunds
      .filter((refund) => refund.outcome === outcome)
      .reduce(
        (total, refund) => total.add(refund.amount),
        new Prisma.Decimal(0),
      );
  const approved = sum('APPROVED');
  const pending = sum('PENDING');
  const expected = alreadyRefundedAmount.add(amount);

  if (approved.gte(expected)) {
    const latest = [...refunds]
      .reverse()
      .find((refund) => refund.outcome === 'APPROVED');

    return { kind: 'REFUNDED', providerRefundReference: latest?.reference };
  }

  if (approved.add(pending).gte(expected)) {
    return { kind: 'PENDING' };
  }

  return approved.add(pending).lte(alreadyRefundedAmount)
    ? { kind: 'NOT_REFUNDED' }
    : { kind: 'UNKNOWN' };
}

import { PaymentMethod, PaymentStatus, RefundMethod } from '@prisma/client';
import { zonedDateKey } from '../../../common/time/restaurant-time';

export type RefundModeDeniedCode =
  'REFUND_PAYMENT_NOT_PAID' | 'REFUND_ADMIN_ONLY' | 'REFUND_CASHIER_DAY_LIMIT';

export const REFUND_MODE_MESSAGES: Record<RefundModeDeniedCode, string> = {
  REFUND_PAYMENT_NOT_PAID: 'Solo se pueden reembolsar pagos cobrados.',
  REFUND_ADMIN_ONLY:
    'Solo un administrador puede registrar el reembolso de pagos que no son en efectivo.',
  REFUND_CASHIER_DAY_LIMIT:
    'El cajero solo puede reembolsar pagos en efectivo cobrados hoy. Pide a un administrador.',
};

export type RefundModeInput = {
  payment: {
    status: PaymentStatus;
    provider: string;
    method: PaymentMethod | null;
    paidAt: Date | null;
    createdAt: Date;
  };
  isAdmin: boolean;
  now: Date;
  timeZone: string;
};

export type RefundModeResult =
  | { allowed: true; method: RefundMethod }
  | {
      allowed: false;
      code: RefundModeDeniedCode;
      message: string;
      method: RefundMethod | null;
    };

export function resolveRefundMode(input: RefundModeInput): RefundModeResult {
  const { payment, isAdmin, now, timeZone } = input;
  const deny = (
    code: RefundModeDeniedCode,
    method: RefundMethod | null,
  ): RefundModeResult => ({
    allowed: false,
    code,
    message: REFUND_MODE_MESSAGES[code],
    method,
  });

  if (payment.status !== PaymentStatus.PAID) {
    return deny('REFUND_PAYMENT_NOT_PAID', null);
  }

  const isCash =
    payment.provider === 'MANUAL' && payment.method === PaymentMethod.CASH;
  const method = isCash
    ? RefundMethod.CASH_MANUAL
    : RefundMethod.MANUAL_EXTERNAL;

  if (method === RefundMethod.MANUAL_EXTERNAL && !isAdmin) {
    return deny('REFUND_ADMIN_ONLY', method);
  }

  if (
    method === RefundMethod.CASH_MANUAL &&
    !isAdmin &&
    zonedDateKey(payment.paidAt ?? payment.createdAt, timeZone) !==
      zonedDateKey(now, timeZone)
  ) {
    return deny('REFUND_CASHIER_DAY_LIMIT', method);
  }

  return { allowed: true, method };
}

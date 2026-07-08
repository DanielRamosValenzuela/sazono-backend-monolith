import type { Prisma } from '@prisma/client';

export const PAYMENT_PROVIDER = Symbol('PAYMENT_PROVIDER');

export type PaymentChargeInput = {
  amount: Prisma.Decimal;
  currency: string;
  description: string;
};

export type PaymentChargeResult = {
  approved: boolean;
  providerReference?: string;
  failureReason?: string;
};
export interface PaymentProviderPort {
  readonly providerName: string;

  charge(input: PaymentChargeInput): Promise<PaymentChargeResult>;
}

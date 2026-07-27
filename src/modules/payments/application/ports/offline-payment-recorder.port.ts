import type { Prisma } from '@prisma/client';

export const OFFLINE_PAYMENT_RECORDER = Symbol('OFFLINE_PAYMENT_RECORDER');

export type OfflinePaymentRecordInput = {
  amount: Prisma.Decimal;
  currency: string;
  description: string;
};

export type OfflinePaymentRecord = {
  providerReference: string;
};

export interface OfflinePaymentRecorderPort {
  readonly providerName: string;

  record(input: OfflinePaymentRecordInput): Promise<OfflinePaymentRecord>;
}

import type { Prisma } from '@prisma/client';

export type GatewayChargeContext = {
  restaurantId: string;
  attemptId: string;
  amount: Prisma.Decimal;
  currency: string;
  description: string;
  externalReference: string;
  cardToken: string;
  paymentMethodId: string;
  installments: number;
  issuerId?: string;
  payerEmail?: string;
  notificationUrl?: string;
  applicationFeeAmount?: number;
};

export type GatewayOutcomeStatus = 'APPROVED' | 'REJECTED';

export type GatewayChargeOutcome = {
  outcome: GatewayOutcomeStatus;
  providerReference?: string;
  failureReason?: string;
  rawStatus?: string;
  rawStatusDetail?: string;
};

export type GatewayPaymentSnapshotStatus = GatewayOutcomeStatus | 'PENDING';

export type GatewayPaymentSnapshot = {
  providerReference: string;
  outcome: GatewayPaymentSnapshotStatus;
  rawStatus: string;
  rawStatusDetail?: string;
  amount?: string;
  currency?: string;
  externalReference?: string;
};

export interface PaymentGatewayPort {
  readonly providerName: string;

  charge(context: GatewayChargeContext): Promise<GatewayChargeOutcome>;

  getPayment(providerReference: string): Promise<GatewayPaymentSnapshot | null>;
}

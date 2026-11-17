import type { PaymentMethod, Prisma } from '@prisma/client';

export type GatewayCredentials = {
  accessToken?: string;
  childCommerceCode?: string;
};

export type GatewayChargeContext = {
  restaurantId: string;
  attemptId: string;
  amount: Prisma.Decimal;
  currency: string;
  description: string;
  externalReference: string;
  credentials: GatewayCredentials;
  notificationUrl?: string;
  applicationFeeAmount?: number;
  checkoutPayload?: unknown;
};

export type GatewaySettledResult = 'APPROVED' | 'REJECTED';

export type GatewayPaymentDetails = {
  paymentMethod?: PaymentMethod;
  gatewayMeta?: Prisma.InputJsonObject;
};

export type GatewayChargeOutcome =
  | ({
      kind: 'SETTLED';
      result: GatewaySettledResult;
      providerReference?: string;
      failureReason?: string;
      rawStatus?: string;
      rawStatusDetail?: string;
    } & GatewayPaymentDetails)
  | {
      kind: 'REDIRECT';
      providerReference: string;
      redirectUrl: string;
      method: 'POST';
      fields: Record<string, string>;
      expiresAt: Date;
    };

export type GatewayPendingChargeOutcome = {
  kind: 'PENDING';
  providerReference?: string;
  rawStatus?: string;
  rawStatusDetail?: string;
};

export type GatewayPaymentSnapshotStatus = GatewaySettledResult | 'PENDING';

export type GatewayPaymentSnapshot = {
  providerReference: string;
  outcome: GatewayPaymentSnapshotStatus;
  rawStatus: string;
  rawStatusDetail?: string;
  amount?: string;
  currency?: string;
  externalReference?: string;
} & GatewayPaymentDetails;

export interface PaymentGatewayPort {
  readonly providerName: string;
  readonly checkoutMode: 'embedded' | 'redirect';

  charge(
    context: GatewayChargeContext,
  ): Promise<GatewayChargeOutcome | GatewayPendingChargeOutcome>;

  confirmRedirect?(
    providerReference: string,
    credentials: GatewayCredentials,
  ): Promise<GatewayChargeOutcome>;

  getPayment(
    providerReference: string,
    credentials: GatewayCredentials,
  ): Promise<GatewayPaymentSnapshot | null>;

  findByExternalReference?(
    externalReference: string,
    credentials: GatewayCredentials,
  ): Promise<GatewayPaymentSnapshot | null>;
}

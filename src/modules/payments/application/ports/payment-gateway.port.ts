import type { Prisma } from '@prisma/client';

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

export type GatewayChargeOutcome =
  | {
      kind: 'SETTLED';
      result: GatewaySettledResult;
      providerReference?: string;
      failureReason?: string;
      rawStatus?: string;
      rawStatusDetail?: string;
    }
  | {
      kind: 'REDIRECT';
      providerReference: string;
      redirectUrl: string;
      method: 'POST';
      fields: Record<string, string>;
      expiresAt: Date;
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
};

export interface PaymentGatewayPort {
  readonly providerName: string;
  readonly checkoutMode: 'embedded' | 'redirect';

  charge(context: GatewayChargeContext): Promise<GatewayChargeOutcome>;

  confirmRedirect?(
    providerReference: string,
    credentials: GatewayCredentials,
  ): Promise<GatewayChargeOutcome>;

  getPayment(
    providerReference: string,
    credentials: GatewayCredentials,
  ): Promise<GatewayPaymentSnapshot | null>;
}

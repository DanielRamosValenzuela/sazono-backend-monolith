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

export type GatewayRemoteRefund = {
  reference: string;
  amount: string;
  outcome: 'APPROVED' | 'PENDING' | 'REJECTED';
};

export type GatewayPaymentSnapshot = {
  providerReference: string;
  refunds?: GatewayRemoteRefund[];
  chargedBack?: boolean;
  outcome: GatewayPaymentSnapshotStatus;
  rawStatus: string;
  rawStatusDetail?: string;
  amount?: string;
  currency?: string;
  externalReference?: string;
} & GatewayPaymentDetails;

export interface PaymentGatewayPort extends Partial<PaymentGatewayRefundPort> {
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

export type GatewayRefundContext = {
  restaurantId: string;
  refundId: string;
  idempotencyKey: string;
  providerReference: string;
  amount: Prisma.Decimal;
  paymentAmount: Prisma.Decimal;
  alreadyRefundedAmount: Prisma.Decimal;
  currency: string;
  credentials: GatewayCredentials;
  gatewayMeta: Record<string, unknown> | null;
  providerRefundReference?: string | null;
};

export type GatewayRefundOutcome =
  | {
      kind: 'REFUNDED';
      providerRefundReference?: string;
      raw?: Prisma.InputJsonValue;
    }
  | {
      kind: 'PENDING';
      providerRefundReference?: string;
      raw?: Prisma.InputJsonValue;
    }
  | {
      kind: 'REJECTED';
      retryable: boolean;
      failureReason: string;
      code?: string;
      raw?: Prisma.InputJsonValue;
    }
  | { kind: 'AMBIGUOUS'; raw?: Prisma.InputJsonValue };

export type GatewayRefundState =
  | {
      kind: 'REFUNDED';
      providerRefundReference?: string;
      raw?: Prisma.InputJsonValue;
    }
  | { kind: 'PENDING'; raw?: Prisma.InputJsonValue }
  | { kind: 'NOT_REFUNDED'; raw?: Prisma.InputJsonValue }
  | { kind: 'UNKNOWN'; raw?: Prisma.InputJsonValue };

export interface PaymentGatewayRefundPort {
  refund(context: GatewayRefundContext): Promise<GatewayRefundOutcome>;

  getRefundState(context: GatewayRefundContext): Promise<GatewayRefundState>;
}

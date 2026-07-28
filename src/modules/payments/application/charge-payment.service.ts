import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { assertNever } from '../domain/assert-never';
import { PaymentChannel } from '../domain/payment-channel';
import { MERCADOPAGO_PROVIDER_NAME } from '../domain/mercado-pago-status';
import { MercadoPagoConfigService } from '../infrastructure/mercado-pago/mercado-pago-config.service';
import {
  OFFLINE_PAYMENT_RECORDER,
  type OfflinePaymentRecorderPort,
} from './ports/offline-payment-recorder.port';
import {
  PAYMENT_GATEWAY_RESOLVER,
  type PaymentGatewayResolverPort,
  type ResolvedPaymentGateway,
} from './ports/payment-gateway-resolver.port';
import type { GatewayChargeOutcome } from './ports/payment-gateway.port';

export type ChargePaymentCheckout = {
  cardToken: string;
  paymentMethodId: string;
  installments: number;
  issuerId?: string;
  payerEmail?: string;
};

export type ChargePaymentRequest = {
  channel: PaymentChannel;
  restaurantId: string;
  attemptId: string;
  amount: Prisma.Decimal;
  currency: string;
  description: string;
  checkout?: ChargePaymentCheckout;
};

export type ChargePaymentResult =
  | {
      kind: 'SETTLED';
      approved: boolean;
      providerName: string;
      providerReference?: string;
      failureReason?: string;
    }
  | {
      kind: 'REDIRECT';
      providerName: string;
      providerReference: string;
      redirectUrl: string;
      method: 'POST';
      fields: Record<string, string>;
      expiresAt: Date;
    };

const NO_GATEWAY_CONNECTED_FAILURE_REASON =
  'Este restaurante todavia no tiene una pasarela de pago conectada.';
const MISSING_CHECKOUT_FAILURE_REASON =
  'Falta el token de la tarjeta para completar el pago.';

@Injectable()
export class ChargePaymentService {
  constructor(
    @Inject(OFFLINE_PAYMENT_RECORDER)
    private readonly offlinePaymentRecorder: OfflinePaymentRecorderPort,
    @Inject(PAYMENT_GATEWAY_RESOLVER)
    private readonly paymentGatewayResolver: PaymentGatewayResolverPort,
    private readonly mercadoPagoConfig: MercadoPagoConfigService,
  ) {}

  async execute(request: ChargePaymentRequest): Promise<ChargePaymentResult> {
    if (request.channel === PaymentChannel.STAFF_OFFLINE) {
      return this.recordOffline(request);
    }

    const availableGateways =
      await this.paymentGatewayResolver.resolveAvailable(request.restaurantId);
    const preferredGateway = availableGateways[0] ?? null;

    if (preferredGateway !== null && request.checkout !== undefined) {
      return this.chargeThroughGateway(
        preferredGateway,
        request,
        request.checkout,
      );
    }

    if (this.mercadoPagoConfig.qrGatewayRequired) {
      return this.rejectMissingGatewayOrCheckout(preferredGateway);
    }

    return this.recordOffline(request);
  }

  private async chargeThroughGateway(
    resolvedGateway: ResolvedPaymentGateway,
    request: ChargePaymentRequest,
    checkout: ChargePaymentCheckout,
  ): Promise<ChargePaymentResult> {
    const outcome = await resolvedGateway.gateway.charge({
      restaurantId: request.restaurantId,
      attemptId: request.attemptId,
      amount: request.amount,
      currency: request.currency,
      description: request.description,
      externalReference: request.attemptId,
      credentials: resolvedGateway.credentials,
      notificationUrl: this.resolveWebhookNotificationUrl(),
      checkoutPayload: checkout,
    });

    return this.toChargePaymentResult(resolvedGateway, outcome);
  }

  private toChargePaymentResult(
    resolvedGateway: ResolvedPaymentGateway,
    outcome: GatewayChargeOutcome,
  ): ChargePaymentResult {
    switch (outcome.kind) {
      case 'SETTLED':
        return {
          kind: 'SETTLED',
          approved: outcome.result === 'APPROVED',
          providerName: resolvedGateway.gateway.providerName,
          providerReference: outcome.providerReference,
          failureReason: outcome.failureReason,
        };
      case 'REDIRECT':
        return {
          kind: 'REDIRECT',
          providerName: resolvedGateway.gateway.providerName,
          providerReference: outcome.providerReference,
          redirectUrl: outcome.redirectUrl,
          method: outcome.method,
          fields: outcome.fields,
          expiresAt: outcome.expiresAt,
        };
      default:
        return assertNever(outcome);
    }
  }

  private resolveWebhookNotificationUrl(): string | undefined {
    try {
      return this.mercadoPagoConfig.webhookUrl;
    } catch {
      return undefined;
    }
  }

  private rejectMissingGatewayOrCheckout(
    resolvedGateway: ResolvedPaymentGateway | null,
  ): ChargePaymentResult {
    return {
      kind: 'SETTLED',
      approved: false,
      providerName:
        resolvedGateway?.gateway.providerName ?? MERCADOPAGO_PROVIDER_NAME,
      failureReason: resolvedGateway
        ? MISSING_CHECKOUT_FAILURE_REASON
        : NO_GATEWAY_CONNECTED_FAILURE_REASON,
    };
  }

  private async recordOffline(
    request: ChargePaymentRequest,
  ): Promise<ChargePaymentResult> {
    const record = await this.offlinePaymentRecorder.record({
      amount: request.amount,
      currency: request.currency,
      description: request.description,
    });

    return {
      kind: 'SETTLED',
      approved: true,
      providerName: this.offlinePaymentRecorder.providerName,
      providerReference: record.providerReference,
    };
  }
}

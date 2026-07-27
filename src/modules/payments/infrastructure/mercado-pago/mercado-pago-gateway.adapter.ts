import { Logger } from '@nestjs/common';
import { MercadoPagoConfig, Payment } from 'mercadopago';
import {
  MERCADOPAGO_PROVIDER_NAME,
  mapMercadoPagoStatus,
} from '../../domain/mercado-pago-status';
import { toGatewayAmount } from './mercado-pago-amount';
import type {
  GatewayChargeContext,
  GatewayChargeOutcome,
  GatewayPaymentSnapshot,
  PaymentGatewayPort,
} from '../../application/ports/payment-gateway.port';

const MERCADOPAGO_DEFAULT_TIMEOUT_MS = 15000;
const NETWORK_ERROR_FAILURE_REASON =
  'No pudimos comunicarnos con la pasarela de pago. Intenta nuevamente.';
const PENDING_FALLBACK_FAILURE_REASON =
  'El pago quedo en revision y fue cancelado por seguridad. Intenta con otro medio de pago.';

type MercadoPagoPaymentResponse = Awaited<ReturnType<Payment['create']>>;

export class MercadoPagoGatewayAdapter implements PaymentGatewayPort {
  readonly providerName = MERCADOPAGO_PROVIDER_NAME;
  private readonly logger = new Logger(MercadoPagoGatewayAdapter.name);
  private readonly paymentClient: Payment;

  constructor(
    accessToken: string,
    timeoutMs: number = MERCADOPAGO_DEFAULT_TIMEOUT_MS,
  ) {
    const config = new MercadoPagoConfig({
      accessToken,
      options: {
        timeout: timeoutMs,
      },
    });

    this.paymentClient = new Payment(config);
  }

  async charge(context: GatewayChargeContext): Promise<GatewayChargeOutcome> {
    const transactionAmount = toGatewayAmount(context.amount, context.currency);

    try {
      const response = await this.paymentClient.create({
        body: {
          transaction_amount: transactionAmount,
          token: context.cardToken,
          payment_method_id: context.paymentMethodId,
          installments: context.installments,
          issuer_id:
            context.issuerId !== undefined
              ? Number(context.issuerId)
              : undefined,
          description: context.description,
          external_reference: context.externalReference,
          binary_mode: true,
          payer:
            context.payerEmail !== undefined
              ? { email: context.payerEmail }
              : undefined,
          notification_url: context.notificationUrl,
        },
        requestOptions: {
          idempotencyKey: context.attemptId,
        },
      });

      return this.buildOutcomeFromResponse(response);
    } catch (error) {
      this.logger.error(this.describeError(error, 'charge'));

      return {
        outcome: 'REJECTED',
        failureReason: NETWORK_ERROR_FAILURE_REASON,
      };
    }
  }

  async getPayment(
    providerReference: string,
  ): Promise<GatewayPaymentSnapshot | null> {
    try {
      const response = await this.paymentClient.get({ id: providerReference });

      if (response.id === undefined || response.status === undefined) {
        return null;
      }

      const mapped = mapMercadoPagoStatus(
        response.status,
        response.status_detail,
      );

      return {
        providerReference: String(response.id),
        outcome: mapped.outcome,
        rawStatus: response.status,
        rawStatusDetail: response.status_detail,
        amount: response.transaction_amount?.toString(),
        currency: response.currency_id,
        externalReference: response.external_reference ?? undefined,
      };
    } catch (error) {
      this.logger.warn(this.describeError(error, 'getPayment'));

      return null;
    }
  }

  private async buildOutcomeFromResponse(
    response: MercadoPagoPaymentResponse,
  ): Promise<GatewayChargeOutcome> {
    const status = response.status ?? 'unknown';
    const statusDetail = response.status_detail;
    const providerReference =
      response.id !== undefined ? String(response.id) : undefined;
    const mapped = mapMercadoPagoStatus(status, statusDetail);

    if (mapped.outcome === 'PENDING') {
      return this.cancelPendingPayment(
        response.id,
        providerReference,
        status,
        statusDetail,
      );
    }

    return {
      outcome: mapped.outcome,
      providerReference,
      failureReason: mapped.failureReason,
      rawStatus: status,
      rawStatusDetail: statusDetail,
    };
  }

  private async cancelPendingPayment(
    id: number | undefined,
    providerReference: string | undefined,
    status: string,
    statusDetail: string | undefined,
  ): Promise<GatewayChargeOutcome> {
    if (id !== undefined) {
      try {
        await this.paymentClient.cancel({ id });
      } catch (error) {
        this.logger.warn(this.describeError(error, 'cancel-pending-fallback'));
      }
    }

    this.logger.warn(
      `Mercado Pago devolvio un pago pendiente pese a binary_mode=true (providerReference=${providerReference ?? 'desconocido'}, status=${status}). Se cancelo y se trato como rechazo para conciliacion manual.`,
    );

    return {
      outcome: 'REJECTED',
      providerReference,
      failureReason: PENDING_FALLBACK_FAILURE_REASON,
      rawStatus: status,
      rawStatusDetail: statusDetail,
    };
  }

  private describeError(error: unknown, operation: string): string {
    if (error instanceof Error) {
      return `Mercado Pago ${operation} fallo: ${error.message}`;
    }

    if (error && typeof error === 'object') {
      const payload = error as {
        message?: unknown;
        error?: unknown;
        status?: unknown;
      };
      const detail =
        typeof payload.message === 'string'
          ? payload.message
          : typeof payload.error === 'string'
            ? payload.error
            : 'error sin detalle';
      const statusLabel =
        typeof payload.status === 'string' || typeof payload.status === 'number'
          ? String(payload.status)
          : 'desconocido';

      return `Mercado Pago ${operation} fallo (status ${statusLabel}): ${detail}`;
    }

    return `Mercado Pago ${operation} fallo con un error desconocido.`;
  }
}

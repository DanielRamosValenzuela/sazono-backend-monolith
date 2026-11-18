import { Injectable, Logger } from '@nestjs/common';
import { PaymentGatewayProvider, PaymentMethod, Prisma } from '@prisma/client';
import { MercadoPagoConfig, Order, Payment, PaymentRefund } from 'mercadopago';
import {
  mapRemoteRefundOutcome,
  resolveRemoteRefundState,
} from '../../domain/gateway-refund-state';
import { PaymentGatewayAdapter } from '../../domain/payment-gateway-adapter.decorator';
import {
  MERCADOPAGO_PROVIDER_NAME,
  mapMercadoPagoOrderStatus,
  mapMercadoPagoStatus,
} from '../../domain/mercado-pago-status';
import { toGatewayAmount, toOrderAmount } from './mercado-pago-amount';
import { MercadoPagoConfigService } from './mercado-pago-config.service';
import type {
  GatewayChargeContext,
  GatewayChargeOutcome,
  GatewayCredentials,
  GatewayPaymentDetails,
  GatewayPaymentSnapshot,
  GatewayPendingChargeOutcome,
  GatewayRefundContext,
  GatewayRefundOutcome,
  GatewayRefundState,
  GatewayRemoteRefund,
  PaymentGatewayPort,
} from '../../application/ports/payment-gateway.port';

const NETWORK_ERROR_FAILURE_REASON =
  'No pudimos comunicarnos con la pasarela de pago. Intenta nuevamente.';
const PENDING_FALLBACK_FAILURE_REASON =
  'El pago quedo en revision y fue cancelado por seguridad. Intenta con otro medio de pago.';
const MISSING_CHECKOUT_PAYLOAD_FAILURE_REASON =
  'Falta el token de la tarjeta para completar el pago con Mercado Pago.';

const MISSING_TRANSACTION_FAILURE_REASON =
  'No pudimos identificar el pago dentro de Mercado Pago. Registra el reembolso como manual.';
const REFUND_REJECTED_FAILURE_REASON =
  'Mercado Pago no acepto el reembolso. Revisa que la cuenta de Mercado Pago del restaurante tenga saldo disponible o registralo como manual.';
const REFUND_UNAUTHORIZED_FAILURE_REASON =
  'La cuenta de Mercado Pago del restaurante no tiene permiso para reembolsar. Vuelve a conectarla o registra el reembolso como manual.';

type MercadoPagoOrderResponse = Awaited<ReturnType<Order['create']>>;

const ORDER_LOOKBACK_MS = 24 * 60 * 60 * 1000;

type MercadoPagoPaymentResponse = Awaited<ReturnType<Payment['create']>>;

type MercadoPagoCheckoutPayload = {
  cardToken: string;
  paymentMethodId: string;
  installments: number;
  paymentTypeId?: string;
  issuerId?: string;
  payerEmail?: string;
};

function isMercadoPagoCheckoutPayload(
  payload: unknown,
): payload is MercadoPagoCheckoutPayload {
  if (!payload || typeof payload !== 'object') {
    return false;
  }

  const candidate = payload as Record<string, unknown>;

  return (
    typeof candidate.cardToken === 'string' &&
    typeof candidate.paymentMethodId === 'string' &&
    typeof candidate.installments === 'number'
  );
}

@Injectable()
@PaymentGatewayAdapter(PaymentGatewayProvider.MERCADO_PAGO)
export class MercadoPagoGatewayAdapter implements PaymentGatewayPort {
  readonly providerName = MERCADOPAGO_PROVIDER_NAME;
  readonly checkoutMode = 'embedded' as const;
  private readonly logger = new Logger(MercadoPagoGatewayAdapter.name);

  constructor(private readonly mercadoPagoConfig: MercadoPagoConfigService) {}

  async charge(
    context: GatewayChargeContext,
  ): Promise<GatewayChargeOutcome | GatewayPendingChargeOutcome> {
    if (!isMercadoPagoCheckoutPayload(context.checkoutPayload)) {
      return {
        kind: 'SETTLED',
        result: 'REJECTED',
        failureReason: MISSING_CHECKOUT_PAYLOAD_FAILURE_REASON,
      };
    }

    const checkout = context.checkoutPayload;

    if (this.mercadoPagoConfig.apiMode === 'orders') {
      return this.chargeWithOrder(context, checkout);
    }

    const paymentClient = this.buildPaymentClient(context.credentials);
    const transactionAmount = toGatewayAmount(context.amount, context.currency);

    try {
      const response = await paymentClient.create({
        body: {
          transaction_amount: transactionAmount,
          token: checkout.cardToken,
          payment_method_id: checkout.paymentMethodId,
          installments: checkout.installments,
          issuer_id:
            checkout.issuerId !== undefined
              ? Number(checkout.issuerId)
              : undefined,
          description: context.description,
          external_reference: context.externalReference,
          binary_mode: true,
          payer:
            checkout.payerEmail !== undefined
              ? { email: checkout.payerEmail }
              : undefined,
          notification_url: context.notificationUrl,
        },
        requestOptions: {
          idempotencyKey: context.attemptId,
        },
      });

      return this.buildOutcomeFromResponse(paymentClient, response);
    } catch (error) {
      this.logger.error(this.describeError(error, 'charge'));

      return {
        kind: 'SETTLED',
        result: 'REJECTED',
        failureReason: NETWORK_ERROR_FAILURE_REASON,
      };
    }
  }

  async getPayment(
    providerReference: string,
    credentials: GatewayCredentials,
  ): Promise<GatewayPaymentSnapshot | null> {
    if (this.mercadoPagoConfig.apiMode === 'orders') {
      return this.getOrder(providerReference, credentials);
    }

    const paymentClient = this.buildPaymentClient(credentials);

    try {
      const response = await paymentClient.get({ id: providerReference });

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
        refunds: this.mapPaymentRefunds(response.refunds ?? []),
        chargedBack: response.status === 'charged_back',
        ...this.buildPaymentApiDetails(response),
      };
    } catch (error) {
      this.logger.warn(this.describeError(error, 'getPayment'));

      return null;
    }
  }

  private async chargeWithOrder(
    context: GatewayChargeContext,
    checkout: MercadoPagoCheckoutPayload,
  ): Promise<GatewayChargeOutcome | GatewayPendingChargeOutcome> {
    const orderClient = this.buildOrderClient(context.credentials);
    const amount = toOrderAmount(context.amount, context.currency);

    try {
      const response = await orderClient.create({
        body: {
          type: 'online',
          external_reference: context.externalReference,
          total_amount: amount,
          currency: context.currency,
          capture_mode: 'automatic',
          description: context.description,
          payer:
            checkout.payerEmail !== undefined
              ? { email: checkout.payerEmail }
              : undefined,
          marketplace_fee:
            context.applicationFeeAmount !== undefined &&
            context.applicationFeeAmount > 0
              ? String(context.applicationFeeAmount)
              : undefined,
          transactions: {
            payments: [
              {
                amount,
                payment_method: {
                  id: checkout.paymentMethodId,
                  type: checkout.paymentTypeId ?? 'credit_card',
                  token: checkout.cardToken,
                  installments: checkout.installments,
                },
              },
            ],
          },
        },
        requestOptions: {
          idempotencyKey: context.attemptId,
        },
      });

      return this.buildOutcomeFromOrder(response);
    } catch (error) {
      const ambiguous = this.isAmbiguousOrderError(error);

      if (ambiguous) {
        const existing = await this.findExistingOrder(
          orderClient,
          context.externalReference,
        );

        if (existing !== null) {
          return this.buildOutcomeFromOrder(existing);
        }
      }

      this.logger.error(this.describeError(error, 'charge-order'));

      if (ambiguous) {
        return { kind: 'PENDING' };
      }

      return {
        kind: 'SETTLED',
        result: 'REJECTED',
        failureReason: NETWORK_ERROR_FAILURE_REASON,
      };
    }
  }

  async findByExternalReference(
    externalReference: string,
    credentials: GatewayCredentials,
  ): Promise<GatewayPaymentSnapshot | null> {
    if (this.mercadoPagoConfig.apiMode !== 'orders') {
      return null;
    }

    const existing = await this.findExistingOrder(
      this.buildOrderClient(credentials),
      externalReference,
    );

    return existing?.id ? this.getOrder(existing.id, credentials) : null;
  }

  private async getOrder(
    providerReference: string,
    credentials: GatewayCredentials,
  ): Promise<GatewayPaymentSnapshot | null> {
    const orderClient = this.buildOrderClient(credentials);

    try {
      const response = await orderClient.get({ id: providerReference });

      if (response.id === undefined || response.status === undefined) {
        return null;
      }

      const statusDetail = this.resolveOrderStatusDetail(response);
      const mapped = mapMercadoPagoOrderStatus(response.status, statusDetail);

      return {
        providerReference: response.id,
        outcome: mapped.outcome,
        rawStatus: response.status,
        rawStatusDetail: statusDetail,
        amount: response.total_amount,
        currency: response.currency,
        externalReference: response.external_reference ?? undefined,
        refunds: this.mapOrderRefunds(response),
        chargedBack: (response.transactions?.chargebacks?.length ?? 0) > 0,
        ...this.buildOrderDetails(response),
      };
    } catch (error) {
      this.logger.warn(this.describeError(error, 'getOrder'));

      return null;
    }
  }

  private buildOutcomeFromOrder(
    response: MercadoPagoOrderResponse,
  ): GatewayChargeOutcome | GatewayPendingChargeOutcome {
    const status = response.status ?? 'unknown';
    const statusDetail = this.resolveOrderStatusDetail(response);
    const mapped = mapMercadoPagoOrderStatus(status, statusDetail);

    if (mapped.outcome === 'PENDING') {
      if (response.id === undefined) {
        this.logger.error(
          `Mercado Pago devolvio una order no final sin id (status=${status}). Se trato como rechazo porque no se puede reconciliar.`,
        );

        return {
          kind: 'SETTLED',
          result: 'REJECTED',
          failureReason: PENDING_FALLBACK_FAILURE_REASON,
          rawStatus: status,
          rawStatusDetail: statusDetail,
        };
      }

      this.logger.warn(
        `Mercado Pago devolvio una order no final (providerReference=${response.id}, status=${status}). Queda PENDING hasta que el webhook o la conciliacion la resuelvan.`,
      );

      return {
        kind: 'PENDING',
        providerReference: response.id,
        rawStatus: status,
        rawStatusDetail: statusDetail,
      };
    }

    return {
      kind: 'SETTLED',
      result: mapped.outcome,
      providerReference: response.id,
      failureReason: mapped.failureReason,
      rawStatus: status,
      rawStatusDetail: statusDetail,
      ...this.buildOrderDetails(response),
    };
  }

  private buildOrderDetails(
    response: MercadoPagoOrderResponse,
  ): GatewayPaymentDetails {
    const payment = response.transactions?.payments?.[0];

    return {
      paymentMethod: PaymentMethod.MERCADO_PAGO,
      gatewayMeta: {
        transactionId: payment?.id ?? null,
        payment_type_id: payment?.payment_method?.type ?? null,
        payment_method_id: payment?.payment_method?.id ?? null,
        installments: payment?.payment_method?.installments ?? null,
      },
    };
  }

  private buildPaymentApiDetails(
    response: MercadoPagoPaymentResponse,
  ): GatewayPaymentDetails {
    return {
      paymentMethod: PaymentMethod.MERCADO_PAGO,
      gatewayMeta: {
        transactionId: response.id !== undefined ? String(response.id) : null,
        payment_type_id: response.payment_type_id ?? null,
        payment_method_id: response.payment_method_id ?? null,
        installments: response.installments ?? null,
      },
    };
  }

  private resolveOrderStatusDetail(
    response: MercadoPagoOrderResponse,
  ): string | undefined {
    return (
      response.transactions?.payments?.[0]?.status_detail ??
      response.status_detail
    );
  }

  private isAmbiguousOrderError(error: unknown): boolean {
    const status =
      error && typeof error === 'object'
        ? (error as { status?: unknown }).status
        : undefined;

    if (typeof status !== 'number') {
      return true;
    }

    return status >= 500 || status === 408 || status === 409 || status === 423;
  }

  private async findExistingOrder(
    orderClient: Order,
    externalReference: string,
  ): Promise<MercadoPagoOrderResponse | null> {
    try {
      const now = Date.now();
      const result = await orderClient.search({
        options: {
          begin_date: new Date(now - ORDER_LOOKBACK_MS).toISOString(),
          end_date: new Date(now).toISOString(),
          external_reference: externalReference,
        },
      });

      return result.data?.[0] ?? null;
    } catch (error) {
      this.logger.warn(this.describeError(error, 'find-existing-order'));

      return null;
    }
  }

  async refund(context: GatewayRefundContext): Promise<GatewayRefundOutcome> {
    try {
      return this.mercadoPagoConfig.apiMode === 'orders'
        ? await this.refundOrder(context)
        : await this.refundPayment(context);
    } catch (error) {
      return this.buildRefundErrorOutcome(error);
    }
  }

  async getRefundState(
    context: GatewayRefundContext,
  ): Promise<GatewayRefundState> {
    try {
      const refunds =
        this.mercadoPagoConfig.apiMode === 'orders'
          ? await this.listOrderRefunds(context)
          : await this.listPaymentRefunds(context);

      return {
        ...resolveRemoteRefundState({
          refunds,
          alreadyRefundedAmount: context.alreadyRefundedAmount,
          amount: context.amount,
          providerRefundReference: context.providerRefundReference,
        }),
        raw: { refunds },
      };
    } catch (error) {
      this.logger.warn(this.describeError(error, 'getRefundState'));

      return { kind: 'UNKNOWN' };
    }
  }

  private isFullRefund(context: GatewayRefundContext): boolean {
    return (
      context.alreadyRefundedAmount.isZero() &&
      context.amount.eq(context.paymentAmount)
    );
  }

  private async refundOrder(
    context: GatewayRefundContext,
  ): Promise<GatewayRefundOutcome> {
    const orderClient = this.buildOrderClient(context.credentials);
    const amount = toOrderAmount(context.amount, context.currency);
    let body:
      { transactions: Array<{ id: string; amount: string }> } | undefined;

    if (!this.isFullRefund(context)) {
      const transactionId = await this.resolveTransactionId(
        orderClient,
        context,
      );

      if (!transactionId) {
        return {
          kind: 'REJECTED',
          retryable: false,
          code: 'MISSING_TRANSACTION_ID',
          failureReason: MISSING_TRANSACTION_FAILURE_REASON,
        };
      }

      body = { transactions: [{ id: transactionId, amount }] };
    }

    const response = await orderClient.refund({
      id: context.providerReference,
      ...(body ? { body } : {}),
      requestOptions: { idempotencyKey: context.idempotencyKey },
    });
    const refunds = this.mapOrderRefunds(response);
    const own = [...refunds]
      .reverse()
      .find((refund) => new Prisma.Decimal(refund.amount).eq(context.amount));

    return this.buildRefundOutcome(own, {
      orderStatus: response.status ?? null,
      refunds,
    });
  }

  private async refundPayment(
    context: GatewayRefundContext,
  ): Promise<GatewayRefundOutcome> {
    const refundClient = new PaymentRefund(
      this.buildSdkConfig(context.credentials),
    );
    const requestOptions = { idempotencyKey: context.idempotencyKey };
    const response = this.isFullRefund(context)
      ? await refundClient.total({
          payment_id: context.providerReference,
          requestOptions,
        })
      : await refundClient.create({
          payment_id: context.providerReference,
          body: { amount: toGatewayAmount(context.amount, context.currency) },
          requestOptions,
        });
    const own: GatewayRemoteRefund | undefined =
      response.id === undefined
        ? undefined
        : {
            reference: String(response.id),
            amount: String(response.amount ?? context.amount.toString()),
            outcome: mapRemoteRefundOutcome(response.status),
          };

    return this.buildRefundOutcome(own, { status: response.status ?? null });
  }

  private buildRefundOutcome(
    own: GatewayRemoteRefund | undefined,
    raw: Prisma.InputJsonObject,
  ): GatewayRefundOutcome {
    if (own?.outcome === 'APPROVED') {
      return { kind: 'REFUNDED', providerRefundReference: own.reference, raw };
    }

    if (own?.outcome === 'REJECTED') {
      return {
        kind: 'REJECTED',
        retryable: false,
        code: 'REFUND_REJECTED',
        failureReason: REFUND_REJECTED_FAILURE_REASON,
        raw,
      };
    }

    return { kind: 'PENDING', providerRefundReference: own?.reference, raw };
  }

  private async resolveTransactionId(
    orderClient: Order,
    context: GatewayRefundContext,
  ): Promise<string | null> {
    const stored = context.gatewayMeta?.transactionId;

    if (typeof stored === 'string' && stored.length > 0) {
      return stored;
    }

    try {
      const order = await orderClient.get({ id: context.providerReference });

      return order.transactions?.payments?.[0]?.id ?? null;
    } catch (error) {
      this.logger.warn(this.describeError(error, 'refund-resolve-transaction'));

      return null;
    }
  }

  private mapOrderRefunds(
    response: MercadoPagoOrderResponse,
  ): GatewayRemoteRefund[] {
    return (response.transactions?.refunds ?? []).flatMap((refund) =>
      refund.id === undefined
        ? []
        : [
            {
              reference: refund.id,
              amount: refund.amount ?? '0',
              outcome: mapRemoteRefundOutcome(refund.status),
            },
          ],
    );
  }

  private mapPaymentRefunds(
    refunds: Array<{ id?: number; amount?: number; status?: string }>,
  ): GatewayRemoteRefund[] {
    return refunds.flatMap((refund) =>
      refund.id === undefined
        ? []
        : [
            {
              reference: String(refund.id),
              amount: String(refund.amount ?? 0),
              outcome: mapRemoteRefundOutcome(refund.status),
            },
          ],
    );
  }

  private async listOrderRefunds(
    context: GatewayRefundContext,
  ): Promise<GatewayRemoteRefund[]> {
    const order = await this.buildOrderClient(context.credentials).get({
      id: context.providerReference,
    });

    return this.mapOrderRefunds(order);
  }

  private async listPaymentRefunds(
    context: GatewayRefundContext,
  ): Promise<GatewayRemoteRefund[]> {
    const refunds = await new PaymentRefund(
      this.buildSdkConfig(context.credentials),
    ).list({ payment_id: context.providerReference });

    return this.mapPaymentRefunds(refunds);
  }

  private buildRefundErrorOutcome(error: unknown): GatewayRefundOutcome {
    this.logger.error(this.describeError(error, 'refund'));
    const payload =
      error && typeof error === 'object'
        ? (error as { status?: unknown; message?: unknown })
        : {};
    const status = typeof payload.status === 'number' ? payload.status : null;
    const raw = {
      status,
      message:
        typeof payload.message === 'string'
          ? payload.message.slice(0, 300)
          : null,
    };

    if (status === null || this.isAmbiguousOrderError(error)) {
      return { kind: 'AMBIGUOUS', raw };
    }

    if (status === 401 || status === 403) {
      return {
        kind: 'REJECTED',
        retryable: false,
        code: 'UNAUTHORIZED',
        failureReason: REFUND_UNAUTHORIZED_FAILURE_REASON,
        raw,
      };
    }

    return {
      kind: 'REJECTED',
      retryable: status === 429,
      code: `HTTP_${status}`,
      failureReason: REFUND_REJECTED_FAILURE_REASON,
      raw,
    };
  }

  private buildSdkConfig(credentials: GatewayCredentials): MercadoPagoConfig {
    if (!credentials.accessToken) {
      throw new Error(
        'Mercado Pago requiere un accessToken en las credenciales resueltas.',
      );
    }

    return new MercadoPagoConfig({
      accessToken: credentials.accessToken,
      options: {
        timeout: this.mercadoPagoConfig.timeoutMs,
      },
    });
  }

  private buildPaymentClient(credentials: GatewayCredentials): Payment {
    return new Payment(this.buildSdkConfig(credentials));
  }

  private buildOrderClient(credentials: GatewayCredentials): Order {
    return new Order(this.buildSdkConfig(credentials));
  }

  private async buildOutcomeFromResponse(
    paymentClient: Payment,
    response: MercadoPagoPaymentResponse,
  ): Promise<GatewayChargeOutcome> {
    const status = response.status ?? 'unknown';
    const statusDetail = response.status_detail;
    const providerReference =
      response.id !== undefined ? String(response.id) : undefined;
    const mapped = mapMercadoPagoStatus(status, statusDetail);

    if (mapped.outcome === 'PENDING') {
      return this.cancelPendingPayment(
        paymentClient,
        response.id,
        providerReference,
        status,
        statusDetail,
      );
    }

    return {
      kind: 'SETTLED',
      result: mapped.outcome,
      providerReference,
      failureReason: mapped.failureReason,
      rawStatus: status,
      rawStatusDetail: statusDetail,
      ...this.buildPaymentApiDetails(response),
    };
  }

  private async cancelPendingPayment(
    paymentClient: Payment,
    id: number | undefined,
    providerReference: string | undefined,
    status: string,
    statusDetail: string | undefined,
  ): Promise<GatewayChargeOutcome> {
    if (id !== undefined) {
      try {
        await paymentClient.cancel({ id });
      } catch (error) {
        this.logger.warn(this.describeError(error, 'cancel-pending-fallback'));
      }
    }

    this.logger.warn(
      `Mercado Pago devolvio un pago pendiente pese a binary_mode=true (providerReference=${providerReference ?? 'desconocido'}, status=${status}). Se cancelo y se trato como rechazo para conciliacion manual.`,
    );

    return {
      kind: 'SETTLED',
      result: 'REJECTED',
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

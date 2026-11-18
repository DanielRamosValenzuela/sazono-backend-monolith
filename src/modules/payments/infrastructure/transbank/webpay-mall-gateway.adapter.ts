import { Injectable, Logger } from '@nestjs/common';
import { PaymentGatewayProvider, Prisma } from '@prisma/client';
import { Options, TransactionDetail, WebpayPlus } from 'transbank-sdk';
import { PaymentGatewayAdapter } from '../../domain/payment-gateway-adapter.decorator';
import { buildTransbankBuyOrder } from '../../domain/transbank-buy-order';
import {
  TRANSBANK_PROVIDER_NAME,
  mapTransbankPaymentMethod,
  mapTransbankStatus,
} from '../../domain/transbank-status';
import { toTransbankAmount } from './transbank-amount';
import { TransbankConfigService } from './transbank-config.service';
import type {
  GatewayChargeContext,
  GatewayChargeOutcome,
  GatewayCredentials,
  GatewayPaymentDetails,
  GatewayPaymentSnapshot,
  GatewayRefundContext,
  GatewayRefundOutcome,
  GatewayRefundState,
  PaymentGatewayPort,
} from '../../application/ports/payment-gateway.port';

const WEBPAY_FORM_TIMEOUT_MS = 10 * 60 * 1000;
const NETWORK_ERROR_FAILURE_REASON =
  'No pudimos comunicarnos con la pasarela de pago. Intenta nuevamente.';
const MISSING_CHILD_COMMERCE_CODE_FAILURE_REASON =
  'Este restaurante no tiene un codigo de comercio Transbank configurado.';

const MISSING_REFUND_META_FAILURE_REASON =
  'Este pago no tiene los datos de Transbank necesarios para reembolsar desde Sazono. Registralo como manual.';
const REFUND_REJECTED_FAILURE_REASON =
  'Transbank no acepto el reembolso. Puede estar fuera de plazo, ser una venta en cuotas o no tener saldo disponible. Si ya lo devolviste por otra via, registralo como manual.';

type TransbankCreateResponse = {
  token: string;
  url: string;
};

type TransbankTransactionDetailResponse = {
  amount: number;
  status: string;
  authorization_code?: string;
  payment_type_code?: string;
  response_code: number;
  installments_number?: number;
  commerce_code: string;
  buy_order: string;
  balance?: number;
};

type TransbankCommitResponse = {
  buy_order: string;
  session_id?: string;
  vci?: string;
  accounting_date?: string;
  transaction_date?: string;
  details: TransbankTransactionDetailResponse[];
};

function isTransbankCreateResponse(
  value: unknown,
): value is TransbankCreateResponse {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Record<string, unknown>;

  return (
    typeof candidate.token === 'string' && typeof candidate.url === 'string'
  );
}

function isTransbankCommitResponse(
  value: unknown,
): value is TransbankCommitResponse {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Record<string, unknown>;

  return Array.isArray(candidate.details) && candidate.details.length > 0;
}

@Injectable()
@PaymentGatewayAdapter(PaymentGatewayProvider.TRANSBANK)
export class WebpayMallGatewayAdapter implements PaymentGatewayPort {
  readonly providerName = TRANSBANK_PROVIDER_NAME;
  readonly checkoutMode = 'redirect' as const;
  private readonly logger = new Logger(WebpayMallGatewayAdapter.name);

  constructor(private readonly transbankConfig: TransbankConfigService) {}

  async charge(context: GatewayChargeContext): Promise<GatewayChargeOutcome> {
    const childCommerceCode = context.credentials.childCommerceCode;

    if (!childCommerceCode) {
      return {
        kind: 'SETTLED',
        result: 'REJECTED',
        failureReason: MISSING_CHILD_COMMERCE_CODE_FAILURE_REASON,
      };
    }

    const buyOrder = buildTransbankBuyOrder(context.attemptId);
    const amount = toTransbankAmount(context.amount, context.currency);
    const transaction = this.buildTransaction();

    try {
      const response: unknown = await transaction.create(
        buyOrder,
        buyOrder,
        this.transbankConfig.returnUrl,
        [new TransactionDetail(amount, childCommerceCode, buyOrder)],
      );

      if (!isTransbankCreateResponse(response)) {
        this.logger.error(
          `Transbank create devolvio una respuesta con forma inesperada (buyOrder=${buyOrder}).`,
        );

        return {
          kind: 'SETTLED',
          result: 'REJECTED',
          failureReason: NETWORK_ERROR_FAILURE_REASON,
        };
      }

      return {
        kind: 'REDIRECT',
        providerReference: response.token,
        redirectUrl: response.url,
        method: 'POST',
        fields: { token_ws: response.token },
        expiresAt: new Date(Date.now() + WEBPAY_FORM_TIMEOUT_MS),
      };
    } catch (error) {
      this.logger.error(this.describeError(error, 'create'));

      return {
        kind: 'SETTLED',
        result: 'REJECTED',
        failureReason: NETWORK_ERROR_FAILURE_REASON,
      };
    }
  }

  async confirmRedirect(
    providerReference: string,
    credentials: GatewayCredentials,
  ): Promise<GatewayChargeOutcome> {
    void credentials;
    const transaction = this.buildTransaction();

    try {
      const response: unknown = await transaction.commit(providerReference);

      return this.buildOutcomeFromCommitResponse(providerReference, response);
    } catch (error) {
      this.logger.error(this.describeError(error, 'commit'));

      return {
        kind: 'SETTLED',
        result: 'REJECTED',
        providerReference,
        failureReason: NETWORK_ERROR_FAILURE_REASON,
      };
    }
  }

  async getPayment(
    providerReference: string,
    credentials: GatewayCredentials,
  ): Promise<GatewayPaymentSnapshot | null> {
    void credentials;
    const transaction = this.buildTransaction();

    try {
      const response: unknown = await transaction.status(providerReference);

      if (!isTransbankCommitResponse(response)) {
        return null;
      }

      const detail = response.details[0];
      const mapped = mapTransbankStatus(detail.status, detail.response_code);

      return {
        providerReference,
        outcome: mapped.outcome,
        rawStatus: detail.status,
        rawStatusDetail:
          detail.response_code !== undefined
            ? String(detail.response_code)
            : undefined,
        amount: detail.amount?.toString(),
        currency: 'CLP',
        externalReference: response.buy_order,
        ...this.buildPaymentDetails(detail),
      };
    } catch (error) {
      this.logger.warn(this.describeError(error, 'getPayment'));

      return null;
    }
  }

  async refund(context: GatewayRefundContext): Promise<GatewayRefundOutcome> {
    const meta = this.readRefundMeta(context);

    if (!meta) {
      return {
        kind: 'REJECTED',
        retryable: false,
        code: 'MISSING_GATEWAY_META',
        failureReason: MISSING_REFUND_META_FAILURE_REASON,
      };
    }

    const installments = Number(context.gatewayMeta?.installments ?? 0);
    const isTotal =
      context.alreadyRefundedAmount.isZero() &&
      context.amount.eq(context.paymentAmount);

    if (installments > 1 && !isTotal) {
      return {
        kind: 'REJECTED',
        retryable: false,
        code: 'INSTALLMENTS_PARTIAL_BLOCKED',
        failureReason: `Este pago se hizo en ${installments} cuotas y Transbank solo permite anularlo por el total. Reembolsa el monto completo o registralo como manual.`,
      };
    }

    let amount: number;

    try {
      amount = toTransbankAmount(context.amount, context.currency);
    } catch {
      return {
        kind: 'REJECTED',
        retryable: false,
        code: 'INVALID_AMOUNT',
        failureReason:
          'El monto no es valido para Transbank: debe ser un numero entero de pesos.',
      };
    }

    const transaction = this.buildTransaction();

    try {
      const response: unknown = await transaction.refund(
        context.providerReference,
        meta.buyOrder,
        meta.childCommerceCode,
        amount,
      );

      return this.buildRefundOutcome(response);
    } catch (error) {
      this.logger.error(this.describeError(error, 'refund'));
      const failure = this.parseFailure(error);

      if (failure.httpStatus !== null && failure.httpStatus < 500) {
        return {
          kind: 'REJECTED',
          retryable: failure.httpStatus === 429,
          code: `HTTP_${failure.httpStatus}`,
          failureReason: REFUND_REJECTED_FAILURE_REASON,
          raw: { httpStatus: failure.httpStatus, message: failure.detail },
        };
      }

      return this.resolveAmbiguousRefund(context, failure);
    }
  }

  async getRefundState(
    context: GatewayRefundContext,
  ): Promise<GatewayRefundState> {
    try {
      const response: unknown = await this.buildTransaction().status(
        context.providerReference,
      );

      return this.classifyBalance(context, response);
    } catch (error) {
      this.logger.warn(this.describeError(error, 'getRefundState'));

      return { kind: 'UNKNOWN' };
    }
  }

  private async resolveAmbiguousRefund(
    context: GatewayRefundContext,
    failure: { httpStatus: number | null; detail: string },
  ): Promise<GatewayRefundOutcome> {
    const raw = { httpStatus: failure.httpStatus, message: failure.detail };
    const state = await this.getRefundState(context);

    if (state.kind === 'REFUNDED') {
      return {
        kind: 'REFUNDED',
        raw: { ...raw, statusCheck: state.raw ?? null },
      };
    }

    return { kind: 'AMBIGUOUS', raw: { ...raw, statusCheck: state.kind } };
  }

  private classifyBalance(
    context: GatewayRefundContext,
    response: unknown,
  ): GatewayRefundState {
    if (!isTransbankCommitResponse(response)) {
      return { kind: 'UNKNOWN' };
    }

    const childCode = context.gatewayMeta?.childCommerceCode;
    const detail =
      response.details.find((item) => item.commerce_code === childCode) ??
      response.details[0];
    const raw = {
      status: detail.status,
      balance: detail.balance ?? null,
    };
    const before = context.paymentAmount.sub(context.alreadyRefundedAmount);

    if (typeof detail.balance !== 'number') {
      return { kind: 'UNKNOWN', raw };
    }

    const balance = new Prisma.Decimal(detail.balance);

    if (balance.eq(before.sub(context.amount))) {
      return { kind: 'REFUNDED', raw };
    }

    return balance.eq(before)
      ? { kind: 'NOT_REFUNDED', raw }
      : { kind: 'UNKNOWN', raw };
  }

  private buildRefundOutcome(response: unknown): GatewayRefundOutcome {
    if (!response || typeof response !== 'object') {
      return { kind: 'AMBIGUOUS' };
    }

    const body = response as Record<string, unknown>;
    const raw = {
      type: typeof body.type === 'string' ? body.type : null,
      balance: typeof body.balance === 'number' ? body.balance : null,
      nullifiedAmount:
        typeof body.nullified_amount === 'number'
          ? body.nullified_amount
          : null,
      authorizationCode:
        typeof body.authorization_code === 'string'
          ? body.authorization_code
          : null,
      authorizationDate:
        typeof body.authorization_date === 'string'
          ? body.authorization_date
          : null,
      responseCode:
        typeof body.response_code === 'number' ? body.response_code : null,
    };

    if (
      (body.type === 'REVERSED' || body.type === 'NULLIFIED') &&
      (body.response_code === undefined || body.response_code === 0)
    ) {
      return { kind: 'REFUNDED', raw };
    }

    if (typeof body.response_code === 'number' && body.response_code !== 0) {
      return {
        kind: 'REJECTED',
        retryable: false,
        code: `RESPONSE_${body.response_code}`,
        failureReason: REFUND_REJECTED_FAILURE_REASON,
        raw,
      };
    }

    return { kind: 'AMBIGUOUS', raw };
  }

  private readRefundMeta(
    context: GatewayRefundContext,
  ): { buyOrder: string; childCommerceCode: string } | null {
    const buyOrder = context.gatewayMeta?.buy_order;
    const childCommerceCode =
      context.gatewayMeta?.childCommerceCode ??
      context.credentials.childCommerceCode;

    return typeof buyOrder === 'string' &&
      buyOrder.length > 0 &&
      typeof childCommerceCode === 'string' &&
      childCommerceCode.length > 0
      ? { buyOrder, childCommerceCode }
      : null;
  }

  private parseFailure(error: unknown): {
    httpStatus: number | null;
    detail: string;
  } {
    const message = error instanceof Error ? error.message : '';
    const match = /status code (\d{3})/.exec(message);
    const detail = message.split('\n').slice(1).join(' ').trim().slice(0, 300);

    return { httpStatus: match ? Number(match[1]) : null, detail };
  }

  private buildOutcomeFromCommitResponse(
    providerReference: string,
    response: unknown,
  ): GatewayChargeOutcome {
    if (!isTransbankCommitResponse(response)) {
      this.logger.error(
        `Transbank commit devolvio una respuesta con forma inesperada (token=${providerReference}).`,
      );

      return {
        kind: 'SETTLED',
        result: 'REJECTED',
        providerReference,
        failureReason: NETWORK_ERROR_FAILURE_REASON,
      };
    }

    const detail = response.details[0];
    const mapped = mapTransbankStatus(detail.status, detail.response_code);

    return {
      kind: 'SETTLED',
      result: mapped.outcome,
      providerReference,
      failureReason: mapped.failureReason,
      rawStatus: detail.status,
      rawStatusDetail: String(detail.response_code),
      ...this.buildPaymentDetails(detail),
    };
  }

  private buildPaymentDetails(
    detail: TransbankTransactionDetailResponse,
  ): GatewayPaymentDetails {
    return {
      paymentMethod: mapTransbankPaymentMethod(detail.payment_type_code),
      gatewayMeta: {
        payment_type_code: detail.payment_type_code ?? null,
        installments: detail.installments_number ?? null,
        authorization_code: detail.authorization_code ?? null,
        buy_order: detail.buy_order ?? null,
        childCommerceCode: detail.commerce_code ?? null,
      },
    };
  }

  private buildTransaction(): InstanceType<typeof WebpayPlus.MallTransaction> {
    return new WebpayPlus.MallTransaction(
      new Options(
        this.transbankConfig.mallCommerceCode,
        this.transbankConfig.apiKey,
        this.transbankConfig.environmentUrl,
        this.transbankConfig.timeoutMs,
      ),
    );
  }

  private describeError(error: unknown, operation: string): string {
    if (error instanceof Error) {
      return `Transbank ${operation} fallo: ${error.message}`;
    }

    return `Transbank ${operation} fallo con un error desconocido.`;
  }
}

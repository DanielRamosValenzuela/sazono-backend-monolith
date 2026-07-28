import { Injectable, Logger } from '@nestjs/common';
import { PaymentGatewayProvider } from '@prisma/client';
import { Options, TransactionDetail, WebpayPlus } from 'transbank-sdk';
import { PaymentGatewayAdapter } from '../../domain/payment-gateway-adapter.decorator';
import { buildTransbankBuyOrder } from '../../domain/transbank-buy-order';
import {
  TRANSBANK_PROVIDER_NAME,
  mapTransbankStatus,
} from '../../domain/transbank-status';
import { toTransbankAmount } from './transbank-amount';
import { TransbankConfigService } from './transbank-config.service';
import type {
  GatewayChargeContext,
  GatewayChargeOutcome,
  GatewayCredentials,
  GatewayPaymentSnapshot,
  PaymentGatewayPort,
} from '../../application/ports/payment-gateway.port';

const WEBPAY_FORM_TIMEOUT_MS = 10 * 60 * 1000;
const NETWORK_ERROR_FAILURE_REASON =
  'No pudimos comunicarnos con la pasarela de pago. Intenta nuevamente.';
const MISSING_CHILD_COMMERCE_CODE_FAILURE_REASON =
  'Este restaurante no tiene un codigo de comercio Transbank configurado.';

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
      };
    } catch (error) {
      this.logger.warn(this.describeError(error, 'getPayment'));

      return null;
    }
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

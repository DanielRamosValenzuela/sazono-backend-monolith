import { Inject, Injectable, Logger } from '@nestjs/common';
import type { PaymentAttempt } from '@prisma/client';
import { OrderStatus, PaymentAttemptStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { applyPaymentToBill } from './apply-payment-to-bill';
import { FailPaymentService } from './fail-payment.service';
import { FinalizePaymentService } from './finalize-payment.service';
import {
  PAYMENT_GATEWAY_RESOLVER,
  type PaymentGatewayResolverPort,
} from './ports/payment-gateway-resolver.port';
import type {
  GatewayPaymentSnapshot,
  PaymentGatewayPort,
} from './ports/payment-gateway.port';
import { MERCADOPAGO_PROVIDER_NAME } from '../domain/mercado-pago-status';
import { RestaurantPaymentAccountRepository } from '../infrastructure/mercado-pago/restaurant-payment-account.repository';
import {
  readWebhookDataId,
  readWebhookEventId,
  readWebhookType,
  readWebhookUserId,
  type MercadoPagoWebhookNotification,
} from '../infrastructure/mercado-pago/mercado-pago-webhook-payload';

export type HandleMercadoPagoWebhookInput = {
  body: MercadoPagoWebhookNotification;
  dataId: string | undefined;
};

export type HandleMercadoPagoWebhookStatus =
  'DUPLICATE' | 'IGNORED' | 'PROCESSED' | 'DEFERRED';

export type HandleMercadoPagoWebhookResult = {
  status: HandleMercadoPagoWebhookStatus;
};

const MERCADOPAGO_PAYMENT_EVENT_TYPE = 'payment';
const NO_REAL_CHARGE_TIP_DELTA = new Prisma.Decimal(0);
const WEBHOOK_REJECTED_FAILURE_REASON =
  'El pago fue rechazado por Mercado Pago (confirmado via webhook).';

type AttemptContext = {
  attempt: PaymentAttempt;
  restaurantId: string;
  currency: string;
};

type Correlation = {
  context: AttemptContext;
  gateway: PaymentGatewayPort;
  snapshot?: GatewayPaymentSnapshot;
};

@Injectable()
export class HandleMercadoPagoWebhookService {
  private readonly logger = new Logger(HandleMercadoPagoWebhookService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(PAYMENT_GATEWAY_RESOLVER)
    private readonly paymentGatewayResolver: PaymentGatewayResolverPort,
    private readonly restaurantPaymentAccountRepository: RestaurantPaymentAccountRepository,
    private readonly finalizePaymentService: FinalizePaymentService,
    private readonly failPaymentService: FailPaymentService,
  ) {}

  async execute(
    input: HandleMercadoPagoWebhookInput,
  ): Promise<HandleMercadoPagoWebhookResult> {
    const eventId = readWebhookEventId(input.body);

    if (!eventId) {
      this.logger.warn(
        'Notificacion de Mercado Pago descartada: no trae un id valido en el body.',
      );
      return { status: 'IGNORED' };
    }

    const existingEvent = await this.prisma.paymentWebhookEvent.findUnique({
      where: {
        provider_eventId: {
          provider: MERCADOPAGO_PROVIDER_NAME,
          eventId,
        },
      },
    });

    if (existingEvent) {
      return { status: 'DUPLICATE' };
    }

    const eventType = readWebhookType(input.body);
    const resourceId = input.dataId ?? readWebhookDataId(input.body);

    const event = await this.prisma.paymentWebhookEvent.create({
      data: {
        provider: MERCADOPAGO_PROVIDER_NAME,
        eventId,
        eventType,
        resourceId,
        signatureValid: true,
        payload: input.body as unknown as Prisma.InputJsonValue,
      },
    });

    if (eventType !== MERCADOPAGO_PAYMENT_EVENT_TYPE) {
      await this.markProcessed(event.id);
      return { status: 'IGNORED' };
    }

    if (!resourceId) {
      await this.markProcessed(
        event.id,
        'La notificacion no trae data.id, no se puede correlacionar.',
      );
      return { status: 'DEFERRED' };
    }

    try {
      const correlation = await this.correlate(resourceId, input.body);

      if (!correlation) {
        await this.markProcessed(
          event.id,
          'No fue posible correlacionar la notificacion con un intento de pago conocido.',
        );
        return { status: 'DEFERRED' };
      }

      const snapshot =
        correlation.snapshot ??
        (await correlation.gateway.getPayment(resourceId));

      if (!snapshot) {
        await this.markProcessed(
          event.id,
          'No fue posible reconsultar el pago en Mercado Pago.',
        );
        return { status: 'DEFERRED' };
      }

      await this.applySnapshot(correlation.context, snapshot);
      await this.markProcessed(event.id);
      return { status: 'PROCESSED' };
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Error desconocido al procesar la notificacion de Mercado Pago.';
      this.logger.error(
        `Fallo procesando el webhook ${event.id} (eventId=${eventId}): ${message}`,
      );
      await this.markProcessed(event.id, message);
      return { status: 'DEFERRED' };
    }
  }

  private async correlate(
    resourceId: string,
    body: MercadoPagoWebhookNotification,
  ): Promise<Correlation | null> {
    const attemptByReference = await this.prisma.paymentAttempt.findFirst({
      where: {
        provider: MERCADOPAGO_PROVIDER_NAME,
        providerReference: resourceId,
      },
    });

    if (attemptByReference) {
      const context = await this.resolveAttemptContext(attemptByReference);

      if (!context) {
        return null;
      }

      const resolvedGateway = await this.paymentGatewayResolver.resolve(
        context.restaurantId,
      );

      if (!resolvedGateway) {
        return null;
      }

      return { context, gateway: resolvedGateway.gateway };
    }

    return this.correlateByExternalAccount(resourceId, body);
  }

  private async correlateByExternalAccount(
    resourceId: string,
    body: MercadoPagoWebhookNotification,
  ): Promise<Correlation | null> {
    const externalAccountId = readWebhookUserId(body);

    if (!externalAccountId) {
      return null;
    }

    const account =
      await this.restaurantPaymentAccountRepository.findByExternalAccountId(
        externalAccountId,
      );

    if (!account) {
      return null;
    }

    const resolvedGateway = await this.paymentGatewayResolver.resolve(
      account.restaurantId,
    );

    if (!resolvedGateway) {
      return null;
    }

    const snapshot = await resolvedGateway.gateway.getPayment(resourceId);

    if (!snapshot?.externalReference) {
      return null;
    }

    const attempt = await this.prisma.paymentAttempt.findUnique({
      where: { id: snapshot.externalReference },
    });

    if (!attempt) {
      return null;
    }

    const context = await this.resolveAttemptContext(attempt);

    if (!context) {
      return null;
    }

    return { context, gateway: resolvedGateway.gateway, snapshot };
  }

  private async resolveAttemptContext(
    attempt: PaymentAttempt,
  ): Promise<AttemptContext | null> {
    if (attempt.billId) {
      const bill = await this.prisma.bill.findUnique({
        where: { id: attempt.billId },
        select: {
          branch: {
            select: {
              restaurantId: true,
              restaurant: { select: { currency: true } },
            },
          },
        },
      });

      if (!bill) {
        return null;
      }

      return {
        attempt,
        restaurantId: bill.branch.restaurantId,
        currency: bill.branch.restaurant.currency,
      };
    }

    if (attempt.orderId) {
      const order = await this.prisma.order.findUnique({
        where: { id: attempt.orderId },
        select: {
          billId: true,
          branch: {
            select: {
              restaurantId: true,
              restaurant: { select: { currency: true } },
            },
          },
        },
      });

      if (!order) {
        return null;
      }

      return {
        attempt: { ...attempt, billId: attempt.billId ?? order.billId },
        restaurantId: order.branch.restaurantId,
        currency: order.branch.restaurant.currency,
      };
    }

    return null;
  }

  private async applySnapshot(
    context: AttemptContext,
    snapshot: GatewayPaymentSnapshot,
  ): Promise<void> {
    if (
      context.attempt.status !== PaymentAttemptStatus.PENDING ||
      snapshot.outcome === 'PENDING'
    ) {
      await this.recordProviderStatus(context.attempt.id, snapshot);
      return;
    }

    if (snapshot.outcome === 'APPROVED') {
      await this.finalizeFromWebhook(context, snapshot);
      return;
    }

    await this.failFromWebhook(context, snapshot);
  }

  private async finalizeFromWebhook(
    context: AttemptContext,
    snapshot: GatewayPaymentSnapshot,
  ): Promise<void> {
    const { attempt, currency } = context;

    if (!attempt.billId || attempt.amount === null) {
      await this.recordProviderStatus(attempt.id, snapshot);
      this.logger.warn(
        `Webhook de Mercado Pago aprobo el intento ${attempt.id} pero falta billId o amount para reconciliar el saldo automaticamente. Requiere revision manual.`,
      );
      return;
    }

    const billId = attempt.billId;
    const amount = attempt.amount;

    await this.prisma.$transaction(async (tx) => {
      await this.finalizePaymentService.execute(tx, {
        attemptId: attempt.id,
        billId,
        amount,
        currency,
        provider: MERCADOPAGO_PROVIDER_NAME,
        providerReference:
          snapshot.providerReference ?? attempt.providerReference,
      });

      await applyPaymentToBill(tx, billId, amount, NO_REAL_CHARGE_TIP_DELTA);
    });

    this.logger.warn(
      `Webhook de Mercado Pago reconcilio el intento ${attempt.id}: seguia PENDING pese a binary_mode. Revisar si quedan pasos posteriores (ruteo a cocina o split) por aplicar manualmente.`,
    );
  }

  private async failFromWebhook(
    context: AttemptContext,
    snapshot: GatewayPaymentSnapshot,
  ): Promise<void> {
    const { attempt } = context;

    await this.prisma.$transaction(async (tx) => {
      await this.failPaymentService.execute(tx, {
        attemptId: attempt.id,
        providerReference:
          snapshot.providerReference ?? attempt.providerReference,
        failureReason: WEBHOOK_REJECTED_FAILURE_REASON,
      });

      if (attempt.orderId) {
        await tx.order.updateMany({
          where: {
            id: attempt.orderId,
            status: {
              in: [OrderStatus.AWAITING_PAYMENT, OrderStatus.PAYMENT_FAILED],
            },
          },
          data: {
            status: OrderStatus.PAYMENT_FAILED,
          },
        });
      }
    });
  }

  private async recordProviderStatus(
    attemptId: string,
    snapshot: GatewayPaymentSnapshot,
  ): Promise<void> {
    await this.prisma.paymentAttempt.update({
      where: { id: attemptId },
      data: {
        providerStatus: snapshot.rawStatus,
        providerStatusDetail: snapshot.rawStatusDetail ?? null,
      },
    });
  }

  private async markProcessed(
    eventId: string,
    processError?: string,
  ): Promise<void> {
    await this.prisma.paymentWebhookEvent.update({
      where: { id: eventId },
      data: {
        processedAt: new Date(),
        processError: processError ?? null,
      },
    });
  }
}

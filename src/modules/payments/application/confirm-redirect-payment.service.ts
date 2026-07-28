import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Bill, PaymentAttempt } from '@prisma/client';
import {
  BillSplitParticipantStatus,
  OrderStatus,
  PaymentAttemptStatus,
  PaymentGatewayProvider,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { applyOrderChargeToBill } from '../../orders/application/apply-order-charge-to-bill';
import { routeOrderToStations } from '../../orders/application/route-order-to-stations';
import { applyPaymentToBill } from './apply-payment-to-bill';
import type { BillAfterPayment } from './apply-payment-to-bill';
import { assertNever } from '../domain/assert-never';
import { FailPaymentService } from './fail-payment.service';
import { FinalizePaymentService } from './finalize-payment.service';
import { mapPaymentResult } from './payment-result-mapper';
import type { PaidOrderSummary } from './payment-result-mapper';
import { PaymentGatewayRegistry } from '../infrastructure/payment-gateway-registry.service';
import {
  PAYMENT_GATEWAY_RESOLVER,
  type PaymentGatewayResolverPort,
} from './ports/payment-gateway-resolver.port';
import type {
  GatewayChargeOutcome,
  GatewayCredentials,
  GatewayPaymentSnapshot,
} from './ports/payment-gateway.port';
import { updateBillSplitStatus } from './update-bill-split-status';
import type { PaymentResultResponseDto } from '../presentation/http/dto/payments.dto';

export type ConfirmRedirectPaymentInput = {
  tokenWs?: string;
  tbkToken?: string;
};

export type ConfirmRedirectPaymentStatus =
  'APPROVED' | 'REJECTED' | 'ABORTED' | 'TIMEOUT';

export type ConfirmRedirectPaymentResult = {
  status: ConfirmRedirectPaymentStatus;
  payment: PaymentResultResponseDto | null;
  failureReason?: string;
};

export type ReconcileAttemptOutcome =
  | { kind: 'APPROVED'; payment: PaymentResultResponseDto }
  | { kind: 'REJECTED'; failureReason: string }
  | { kind: 'STILL_PENDING' };

const PAYABLE_ORDER_STATUSES: OrderStatus[] = [
  OrderStatus.AWAITING_PAYMENT,
  OrderStatus.PAYMENT_FAILED,
];

const TIMEOUT_FAILURE_REASON =
  'La sesion de pago expiro antes de que el cliente completara el pago.';
const ABORTED_FAILURE_REASON = 'El cliente cancelo el pago en la pasarela.';
const UNKNOWN_TOKEN_FAILURE_REASON =
  'No encontramos un intento de pago pendiente asociado a este token.';
const MISSING_ADAPTER_FAILURE_REASON =
  'La pasarela de pago de este intento ya no esta registrada.';
const UNEXPECTED_REDIRECT_FAILURE_REASON =
  'La pasarela devolvio una respuesta inesperada al confirmar el pago.';
const GENERIC_REJECTED_FAILURE_REASON =
  'El pago fue rechazado por el proveedor.';
const UNRECONCILED_APPROVAL_FAILURE_REASON =
  'El pago fue aprobado por el proveedor pero no se pudo reconciliar automaticamente. Contacta a soporte.';
const NOT_FOUND_AT_PROVIDER_FAILURE_REASON =
  'La pasarela de pago no tiene un registro de esta transaccion. El intento se marca como fallido.';
const MISSING_PROVIDER_REFERENCE_FAILURE_REASON =
  'El intento de pago no tiene una referencia de la pasarela para reconciliarlo.';

type AttemptContext = {
  currency: string;
  restaurantId: string;
};

@Injectable()
export class ConfirmRedirectPaymentService {
  private readonly logger = new Logger(ConfirmRedirectPaymentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly paymentGatewayRegistry: PaymentGatewayRegistry,
    @Inject(PAYMENT_GATEWAY_RESOLVER)
    private readonly paymentGatewayResolver: PaymentGatewayResolverPort,
    private readonly finalizePaymentService: FinalizePaymentService,
    private readonly failPaymentService: FailPaymentService,
  ) {}

  async execute(
    input: ConfirmRedirectPaymentInput,
  ): Promise<ConfirmRedirectPaymentResult> {
    if (input.tokenWs) {
      return this.confirmToken(input.tokenWs);
    }

    if (input.tbkToken) {
      return this.abortToken(input.tbkToken);
    }

    return {
      status: 'TIMEOUT',
      payment: null,
      failureReason: TIMEOUT_FAILURE_REASON,
    };
  }

  async reconcilePendingAttempt(
    attempt: PaymentAttempt,
  ): Promise<ReconcileAttemptOutcome> {
    const gateway = this.paymentGatewayRegistry.get(
      attempt.provider as PaymentGatewayProvider,
    );

    if (!gateway) {
      return this.rejectUnresolvableAttempt(
        attempt,
        MISSING_ADAPTER_FAILURE_REASON,
      );
    }

    if (!attempt.providerReference) {
      return this.rejectUnresolvableAttempt(
        attempt,
        MISSING_PROVIDER_REFERENCE_FAILURE_REASON,
      );
    }

    const credentials = await this.resolveCredentials(attempt);
    const snapshot = await gateway.getPayment(
      attempt.providerReference,
      credentials,
    );

    if (!snapshot) {
      return this.rejectUnresolvableAttempt(
        attempt,
        NOT_FOUND_AT_PROVIDER_FAILURE_REASON,
      );
    }

    return this.applySnapshotOutcome(attempt, snapshot);
  }

  private async applySnapshotOutcome(
    attempt: PaymentAttempt,
    snapshot: GatewayPaymentSnapshot,
  ): Promise<ReconcileAttemptOutcome> {
    switch (snapshot.outcome) {
      case 'PENDING':
        return { kind: 'STILL_PENDING' };
      case 'APPROVED':
      case 'REJECTED': {
        const outcome: GatewayChargeOutcome = {
          kind: 'SETTLED',
          result: snapshot.outcome,
          providerReference: snapshot.providerReference,
          rawStatus: snapshot.rawStatus,
          rawStatusDetail: snapshot.rawStatusDetail,
        };
        const result = await this.applyOutcome(attempt, outcome);

        if (result.status === 'APPROVED' && result.payment) {
          return { kind: 'APPROVED', payment: result.payment };
        }

        return {
          kind: 'REJECTED',
          failureReason:
            result.failureReason ?? GENERIC_REJECTED_FAILURE_REASON,
        };
      }
      default:
        return assertNever(snapshot.outcome);
    }
  }

  private async rejectUnresolvableAttempt(
    attempt: PaymentAttempt,
    failureReason: string,
  ): Promise<ReconcileAttemptOutcome> {
    await this.prisma.$transaction((tx) =>
      this.failAttempt(tx, attempt, failureReason),
    );

    return { kind: 'REJECTED', failureReason };
  }

  private async confirmToken(
    token: string,
  ): Promise<ConfirmRedirectPaymentResult> {
    const attempt = await this.findAttemptByToken(token);

    if (!attempt) {
      return {
        status: 'REJECTED',
        payment: null,
        failureReason: UNKNOWN_TOKEN_FAILURE_REASON,
      };
    }

    const reused = await this.reuseResolvedAttempt(attempt);

    if (reused) {
      return reused;
    }

    const gateway = this.paymentGatewayRegistry.get(
      attempt.provider as PaymentGatewayProvider,
    );

    if (!gateway?.confirmRedirect) {
      this.logger.error(
        `No hay un adapter con confirmRedirect registrado para el proveedor ${attempt.provider} (intento ${attempt.id}).`,
      );
      await this.failPaymentService.execute(this.prisma, {
        attemptId: attempt.id,
        providerReference: token,
        failureReason: MISSING_ADAPTER_FAILURE_REASON,
      });

      return {
        status: 'REJECTED',
        payment: null,
        failureReason: MISSING_ADAPTER_FAILURE_REASON,
      };
    }

    const credentials = await this.resolveCredentials(attempt);
    const outcome = await gateway.confirmRedirect(token, credentials);

    return this.applyOutcome(attempt, outcome);
  }

  private async abortToken(
    tbkToken: string,
  ): Promise<ConfirmRedirectPaymentResult> {
    const attempt = await this.findAttemptByToken(tbkToken);

    if (!attempt) {
      return {
        status: 'ABORTED',
        payment: null,
        failureReason: ABORTED_FAILURE_REASON,
      };
    }

    const reused = await this.reuseResolvedAttempt(attempt);

    if (reused) {
      return reused;
    }

    await this.prisma.$transaction((tx) =>
      this.failAttempt(tx, attempt, ABORTED_FAILURE_REASON),
    );

    return {
      status: 'ABORTED',
      payment: null,
      failureReason: ABORTED_FAILURE_REASON,
    };
  }

  private async findAttemptByToken(
    token: string,
  ): Promise<PaymentAttempt | null> {
    const redirectProviders = this.paymentGatewayRegistry
      .getAll()
      .filter((gateway) => gateway.checkoutMode === 'redirect')
      .map((gateway) => gateway.providerName);

    if (redirectProviders.length === 0) {
      return null;
    }

    return this.prisma.paymentAttempt.findFirst({
      where: {
        providerReference: token,
        provider: { in: redirectProviders },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  private async reuseResolvedAttempt(
    attempt: PaymentAttempt,
  ): Promise<ConfirmRedirectPaymentResult | null> {
    if (attempt.status === PaymentAttemptStatus.PENDING) {
      return null;
    }

    if (attempt.status === PaymentAttemptStatus.SUCCEEDED) {
      const payment = await this.prisma.payment.findUnique({
        where: { paymentAttemptId: attempt.id },
      });

      if (!payment) {
        return {
          status: 'REJECTED',
          payment: null,
          failureReason:
            attempt.failureReason ?? GENERIC_REJECTED_FAILURE_REASON,
        };
      }

      const bill = await this.prisma.bill.findUniqueOrThrow({
        where: { id: payment.billId },
      });

      return {
        status: 'APPROVED',
        payment: mapPaymentResult(
          payment,
          this.toBillAfterPayment(bill),
          await this.resolveOrderSummary(attempt),
        ),
      };
    }

    return {
      status: 'REJECTED',
      payment: null,
      failureReason: attempt.failureReason ?? GENERIC_REJECTED_FAILURE_REASON,
    };
  }

  private async resolveCredentials(
    attempt: PaymentAttempt,
  ): Promise<GatewayCredentials> {
    const context = await this.resolveAttemptContext(attempt);

    if (!context) {
      return {};
    }

    const availableGateways =
      await this.paymentGatewayResolver.resolveAvailable(context.restaurantId);
    const resolvedGateway = availableGateways.find(
      (candidate) => candidate.provider === attempt.provider,
    );

    return resolvedGateway?.credentials ?? {};
  }

  private async resolveAttemptContext(
    attempt: PaymentAttempt,
  ): Promise<AttemptContext | null> {
    if (!attempt.billId) {
      return null;
    }

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
      currency: bill.branch.restaurant.currency,
      restaurantId: bill.branch.restaurantId,
    };
  }

  private async applyOutcome(
    attempt: PaymentAttempt,
    outcome: GatewayChargeOutcome,
  ): Promise<ConfirmRedirectPaymentResult> {
    switch (outcome.kind) {
      case 'REDIRECT': {
        this.logger.error(
          `confirmRedirect devolvio un REDIRECT inesperado para el intento ${attempt.id}.`,
        );
        await this.failPaymentService.execute(this.prisma, {
          attemptId: attempt.id,
          providerReference: outcome.providerReference,
          failureReason: UNEXPECTED_REDIRECT_FAILURE_REASON,
        });

        return {
          status: 'REJECTED',
          payment: null,
          failureReason: UNEXPECTED_REDIRECT_FAILURE_REASON,
        };
      }
      case 'SETTLED':
        return this.applySettledOutcome(attempt, outcome);
      default:
        return assertNever(outcome);
    }
  }

  private async applySettledOutcome(
    attempt: PaymentAttempt,
    outcome: Extract<GatewayChargeOutcome, { kind: 'SETTLED' }>,
  ): Promise<ConfirmRedirectPaymentResult> {
    switch (outcome.result) {
      case 'APPROVED':
        return this.approve(attempt, outcome);
      case 'REJECTED': {
        const failureReason =
          outcome.failureReason ?? GENERIC_REJECTED_FAILURE_REASON;

        await this.prisma.$transaction((tx) =>
          this.failAttempt(
            tx,
            attempt,
            failureReason,
            outcome.providerReference,
          ),
        );

        return { status: 'REJECTED', payment: null, failureReason };
      }
      default:
        return assertNever(outcome.result);
    }
  }

  private async approve(
    attempt: PaymentAttempt,
    outcome: Extract<GatewayChargeOutcome, { kind: 'SETTLED' }>,
  ): Promise<ConfirmRedirectPaymentResult> {
    if (!attempt.billId || attempt.amount === null) {
      this.logger.error(
        `El proveedor aprobo el intento ${attempt.id} pero falta billId o amount para reconciliarlo automaticamente.`,
      );
      await this.failPaymentService.execute(this.prisma, {
        attemptId: attempt.id,
        providerReference: outcome.providerReference,
        failureReason: UNRECONCILED_APPROVAL_FAILURE_REASON,
      });

      return {
        status: 'REJECTED',
        payment: null,
        failureReason: UNRECONCILED_APPROVAL_FAILURE_REASON,
      };
    }

    const context = await this.resolveAttemptContext(attempt);

    if (!context) {
      this.logger.error(
        `No se pudo resolver el contexto (cuenta/restaurante) del intento ${attempt.id} tras la aprobacion.`,
      );
      await this.failPaymentService.execute(this.prisma, {
        attemptId: attempt.id,
        providerReference: outcome.providerReference,
        failureReason: UNRECONCILED_APPROVAL_FAILURE_REASON,
      });

      return {
        status: 'REJECTED',
        payment: null,
        failureReason: UNRECONCILED_APPROVAL_FAILURE_REASON,
      };
    }

    const payment = await this.prisma.$transaction((tx) =>
      this.finalizeApproved(tx, attempt, context, outcome),
    );

    return { status: 'APPROVED', payment };
  }

  private async finalizeApproved(
    tx: Prisma.TransactionClient,
    attempt: PaymentAttempt,
    context: AttemptContext,
    outcome: Extract<GatewayChargeOutcome, { kind: 'SETTLED' }>,
  ): Promise<PaymentResultResponseDto> {
    const billId = attempt.billId as string;
    const amount = attempt.amount as Prisma.Decimal;
    const tipDelta = attempt.tipAmount ?? new Prisma.Decimal(0);
    const providerReference =
      outcome.providerReference ?? attempt.providerReference ?? undefined;

    if (attempt.orderId) {
      return this.finalizeOrderApproved(
        tx,
        attempt,
        billId,
        amount,
        tipDelta,
        context.currency,
        providerReference,
      );
    }

    if (attempt.billSplitParticipantId) {
      return this.finalizeSplitParticipantApproved(
        tx,
        attempt,
        billId,
        amount,
        tipDelta,
        context.currency,
        providerReference,
      );
    }

    return this.finalizeBillApproved(
      tx,
      attempt,
      billId,
      amount,
      tipDelta,
      context.currency,
      providerReference,
    );
  }

  private async finalizeOrderApproved(
    tx: Prisma.TransactionClient,
    attempt: PaymentAttempt,
    billId: string,
    amount: Prisma.Decimal,
    tipDelta: Prisma.Decimal,
    currency: string,
    providerReference: string | undefined,
  ): Promise<PaymentResultResponseDto> {
    const orderId = attempt.orderId as string;
    const order = await tx.order.findUnique({
      where: { id: orderId },
      include: { orderItems: true },
    });

    const payment = await this.finalizePaymentService.execute(tx, {
      attemptId: attempt.id,
      billId,
      amount,
      currency,
      provider: attempt.provider,
      providerReference,
    });

    if (!order || !PAYABLE_ORDER_STATUSES.includes(order.status)) {
      this.logger.error(
        `El pago del intento ${attempt.id} se confirmo pero la orden ${orderId} ya no admite ruteo automatico. Requiere revision manual.`,
      );
      const billAfterPayment = await applyPaymentToBill(
        tx,
        billId,
        amount,
        tipDelta,
      );

      return mapPaymentResult(
        payment,
        billAfterPayment,
        order ? { orderId: order.id, status: order.status } : null,
      );
    }

    const bill = await tx.bill.findUniqueOrThrow({ where: { id: billId } });
    const chargeItems = order.orderItems.map((item) => ({
      orderItemId: item.id,
      name: item.nameSnapshot,
      price: item.priceSnapshot,
      quantity: item.quantity,
      preparationStationId: item.preparationStationId,
    }));

    await applyOrderChargeToBill(tx, bill, chargeItems);
    const billAfterPayment = await applyPaymentToBill(
      tx,
      billId,
      amount,
      tipDelta,
    );
    await routeOrderToStations(
      tx,
      { id: order.id, branchId: order.branchId },
      chargeItems,
    );
    const updatedOrder = await tx.order.update({
      where: { id: order.id },
      data: { status: OrderStatus.ROUTED },
    });

    return mapPaymentResult(payment, billAfterPayment, {
      orderId: updatedOrder.id,
      status: updatedOrder.status,
    });
  }

  private async finalizeSplitParticipantApproved(
    tx: Prisma.TransactionClient,
    attempt: PaymentAttempt,
    billId: string,
    amount: Prisma.Decimal,
    tipDelta: Prisma.Decimal,
    currency: string,
    providerReference: string | undefined,
  ): Promise<PaymentResultResponseDto> {
    const participantId = attempt.billSplitParticipantId as string;
    const participant = await tx.billSplitParticipant.findUnique({
      where: { id: participantId },
    });

    const payment = await this.finalizePaymentService.execute(tx, {
      attemptId: attempt.id,
      billId,
      billSplitParticipantId: participantId,
      amount,
      currency,
      provider: attempt.provider,
      providerReference,
    });

    const billAfterPayment = await applyPaymentToBill(
      tx,
      billId,
      amount,
      tipDelta,
    );

    if (participant) {
      const allocationRemaining = amount.sub(tipDelta);
      const newPaidAmount = participant.paidAmount.add(allocationRemaining);
      const participantStatus = newPaidAmount.gte(participant.allocatedAmount)
        ? BillSplitParticipantStatus.PAID
        : BillSplitParticipantStatus.PARTIALLY_PAID;

      await tx.billSplitParticipant.update({
        where: { id: participantId },
        data: { paidAmount: newPaidAmount, status: participantStatus },
      });

      await updateBillSplitStatus(tx, participant.billSplitId);
    } else {
      this.logger.error(
        `El intento ${attempt.id} se confirmo pero el participante ${participantId} ya no existe. Requiere revision manual.`,
      );
    }

    return mapPaymentResult(payment, billAfterPayment, null);
  }

  private async finalizeBillApproved(
    tx: Prisma.TransactionClient,
    attempt: PaymentAttempt,
    billId: string,
    amount: Prisma.Decimal,
    tipDelta: Prisma.Decimal,
    currency: string,
    providerReference: string | undefined,
  ): Promise<PaymentResultResponseDto> {
    const payment = await this.finalizePaymentService.execute(tx, {
      attemptId: attempt.id,
      billId,
      amount,
      currency,
      provider: attempt.provider,
      providerReference,
    });

    const billAfterPayment = await applyPaymentToBill(
      tx,
      billId,
      amount,
      tipDelta,
    );

    return mapPaymentResult(payment, billAfterPayment, null);
  }

  private async failAttempt(
    tx: Prisma.TransactionClient,
    attempt: PaymentAttempt,
    failureReason: string,
    providerReference?: string,
  ): Promise<void> {
    await this.failPaymentService.execute(tx, {
      attemptId: attempt.id,
      providerReference: providerReference ?? attempt.providerReference,
      failureReason,
    });

    if (attempt.orderId) {
      await tx.order.updateMany({
        where: { id: attempt.orderId, status: { in: PAYABLE_ORDER_STATUSES } },
        data: { status: OrderStatus.PAYMENT_FAILED },
      });
      return;
    }

    if (attempt.billSplitParticipantId) {
      await tx.billSplitParticipant.updateMany({
        where: {
          id: attempt.billSplitParticipantId,
          status: { not: BillSplitParticipantStatus.PAID },
        },
        data: { status: BillSplitParticipantStatus.FAILED },
      });
    }
  }

  private toBillAfterPayment(bill: Bill): BillAfterPayment {
    return {
      billId: bill.id,
      status: bill.status,
      subtotalAmount: bill.subtotalAmount,
      tipAmount: bill.tipAmount,
      totalAmount: bill.totalAmount,
      remainingAmount: bill.remainingAmount,
    };
  }

  private async resolveOrderSummary(
    attempt: PaymentAttempt,
  ): Promise<PaidOrderSummary | null> {
    if (!attempt.orderId) {
      return null;
    }

    const order = await this.prisma.order.findUnique({
      where: { id: attempt.orderId },
      select: { id: true, status: true },
    });

    return order ? { orderId: order.id, status: order.status } : null;
  }
}

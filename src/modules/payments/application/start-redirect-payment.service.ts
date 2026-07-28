import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { PaymentGatewayProvider } from '@prisma/client';
import {
  BillStatus,
  BillSplitParticipantStatus,
  OrderStatus,
  PaymentAttemptStatus,
  Prisma,
  TableStatus,
} from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { ACTIVE_TABLE_SESSION_STATUSES } from '../../floor/domain/active-table-session-statuses';
import { assertNever } from '../domain/assert-never';
import { FailPaymentService } from './fail-payment.service';
import {
  PAYMENT_GATEWAY_RESOLVER,
  type PaymentGatewayResolverPort,
  type ResolvedPaymentGateway,
} from './ports/payment-gateway-resolver.port';
import type { GatewayChargeOutcome } from './ports/payment-gateway.port';
import type {
  RedirectPaymentResponseDto,
  StartRedirectBillPaymentDto,
  StartRedirectOrderPaymentDto,
  StartRedirectSplitParticipantPaymentDto,
} from '../presentation/http/dto/payments.dto';

const PAYABLE_ORDER_STATUSES: OrderStatus[] = [
  OrderStatus.AWAITING_PAYMENT,
  OrderStatus.PAYMENT_FAILED,
];
const PAYABLE_BILL_STATUSES: BillStatus[] = [
  BillStatus.OPEN,
  BillStatus.PARTIALLY_PAID,
];
const PAYABLE_PARTICIPANT_STATUSES: BillSplitParticipantStatus[] = [
  BillSplitParticipantStatus.PENDING,
  BillSplitParticipantStatus.PARTIALLY_PAID,
  BillSplitParticipantStatus.FAILED,
];

const NO_REDIRECT_GATEWAY_FAILURE_REASON =
  'El proveedor seleccionado no tiene una pasarela de redireccion conectada para este restaurante.';
const UNEXPECTED_SETTLEMENT_FAILURE_REASON =
  'La pasarela de redireccion resolvio el pago de inmediato en vez de redirigir al cliente. Intenta nuevamente.';
const GENERIC_REJECTED_FAILURE_REASON =
  'El pago fue rechazado por el proveedor.';

type PayableBill = {
  id: string;
  status: BillStatus;
  remainingAmount: Prisma.Decimal;
  currency: string;
  restaurantId: string;
};

@Injectable()
export class StartRedirectPaymentService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(PAYMENT_GATEWAY_RESOLVER)
    private readonly paymentGatewayResolver: PaymentGatewayResolverPort,
    private readonly failPaymentService: FailPaymentService,
  ) {}

  async startForQrOrder(
    qrToken: string,
    orderId: string,
    dto: StartRedirectOrderPaymentDto,
  ): Promise<RedirectPaymentResponseDto> {
    const table = await this.prisma.table.findUnique({
      where: { qrToken },
    });

    if (!table || table.status === TableStatus.DISABLED) {
      throw new NotFoundException('El QR indicado no esta disponible.');
    }

    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        orderItems: true,
        tableSession: true,
        branch: { include: { restaurant: true } },
      },
    });

    if (!order || order.tableSession.tableId !== table.id) {
      throw new NotFoundException(
        'La orden indicada no pertenece a la mesa del QR.',
      );
    }

    if (!PAYABLE_ORDER_STATUSES.includes(order.status)) {
      throw new ConflictException(
        'La orden indicada no esta pendiente de pago.',
      );
    }

    const tipDelta = this.parseTipAmount(dto.tipAmount);
    const orderAmount = order.orderItems.reduce(
      (total, item) => total.add(item.priceSnapshot.mul(item.quantity)),
      new Prisma.Decimal(0),
    );
    const paidAmount = orderAmount.add(tipDelta);
    const currency = order.branch.restaurant.currency;
    const resolvedGateway = await this.resolveRedirectGateway(
      order.branch.restaurantId,
      dto.provider,
    );

    const attempt = await this.prisma.paymentAttempt.create({
      data: {
        orderId: order.id,
        billId: order.billId,
        amount: paidAmount,
        tipAmount: tipDelta,
        provider: resolvedGateway.gateway.providerName,
        status: PaymentAttemptStatus.PENDING,
      },
    });

    return this.beginRedirect(
      resolvedGateway,
      order.branch.restaurantId,
      attempt.id,
      paidAmount,
      currency,
      `Orden QR ${order.id}`,
    );
  }

  async startForQrBill(
    qrToken: string,
    dto: StartRedirectBillPaymentDto,
  ): Promise<RedirectPaymentResponseDto> {
    const table = await this.prisma.table.findUnique({
      where: { qrToken },
    });

    if (!table || table.status === TableStatus.DISABLED) {
      throw new NotFoundException('El QR indicado no esta disponible.');
    }

    const activeSession = await this.prisma.tableSession.findFirst({
      where: {
        tableId: table.id,
        status: { in: ACTIVE_TABLE_SESSION_STATUSES },
      },
      include: {
        bill: true,
        branch: { include: { restaurant: true } },
      },
    });

    if (!activeSession?.bill) {
      throw new NotFoundException(
        'La mesa no tiene una cuenta abierta para pagar.',
      );
    }

    return this.startBillRedirect(
      {
        id: activeSession.bill.id,
        status: activeSession.bill.status,
        remainingAmount: activeSession.bill.remainingAmount,
        currency: activeSession.branch.restaurant.currency,
        restaurantId: activeSession.branch.restaurantId,
      },
      dto,
    );
  }

  async startForSplitParticipant(
    participantToken: string,
    dto: StartRedirectSplitParticipantPaymentDto,
  ): Promise<RedirectPaymentResponseDto> {
    const participant = await this.prisma.billSplitParticipant.findFirst({
      where: { participantToken },
      include: {
        billSplit: {
          include: {
            bill: { include: { branch: { include: { restaurant: true } } } },
          },
        },
      },
    });

    if (!participant) {
      throw new NotFoundException(
        'El participante del split indicado no existe.',
      );
    }

    const bill = participant.billSplit.bill;

    if (
      bill.status !== BillStatus.OPEN &&
      bill.status !== BillStatus.PARTIALLY_PAID
    ) {
      throw new ConflictException(
        'La cuenta asociada al split ya no admite pagos.',
      );
    }

    if (!PAYABLE_PARTICIPANT_STATUSES.includes(participant.status)) {
      throw new ConflictException(
        'Este participante ya completo su pago o fue cancelado.',
      );
    }

    const tipDelta = this.parseTipAmount(dto.tipAmount);
    const allocationRemaining = participant.allocatedAmount.sub(
      participant.paidAmount,
    );

    if (allocationRemaining.lte(0)) {
      throw new ConflictException(
        'Este participante no tiene saldo pendiente.',
      );
    }

    const paidAmount = allocationRemaining.add(tipDelta);
    const currency = bill.branch.restaurant.currency;
    const resolvedGateway = await this.resolveRedirectGateway(
      bill.branch.restaurantId,
      dto.provider,
    );

    const attempt = await this.prisma.paymentAttempt.create({
      data: {
        billId: bill.id,
        billSplitParticipantId: participant.id,
        amount: paidAmount,
        tipAmount: tipDelta,
        provider: resolvedGateway.gateway.providerName,
        status: PaymentAttemptStatus.PENDING,
      },
    });

    return this.beginRedirect(
      resolvedGateway,
      bill.branch.restaurantId,
      attempt.id,
      paidAmount,
      currency,
      `Split bill participante ${participant.id}`,
    );
  }

  private async startBillRedirect(
    bill: PayableBill,
    dto: StartRedirectBillPaymentDto,
  ): Promise<RedirectPaymentResponseDto> {
    if (!PAYABLE_BILL_STATUSES.includes(bill.status)) {
      throw new ConflictException(
        'La cuenta indicada no admite pagos en su estado actual.',
      );
    }

    const amount = new Prisma.Decimal(dto.amount);

    if (amount.lte(0)) {
      throw new BadRequestException('El monto a pagar debe ser mayor a cero.');
    }

    const tipDelta = this.parseTipAmount(dto.tipAmount);

    if (amount.gt(bill.remainingAmount)) {
      throw new BadRequestException(
        'El monto pagado supera el saldo pendiente de la cuenta.',
      );
    }

    const paidAmount = amount.add(tipDelta);
    const resolvedGateway = await this.resolveRedirectGateway(
      bill.restaurantId,
      dto.provider,
    );

    const attempt = await this.prisma.paymentAttempt.create({
      data: {
        billId: bill.id,
        amount: paidAmount,
        tipAmount: tipDelta,
        provider: resolvedGateway.gateway.providerName,
        status: PaymentAttemptStatus.PENDING,
      },
    });

    return this.beginRedirect(
      resolvedGateway,
      bill.restaurantId,
      attempt.id,
      paidAmount,
      bill.currency,
      `Pago de cuenta ${bill.id}`,
    );
  }

  private parseTipAmount(tipAmount: string | undefined): Prisma.Decimal {
    const tipDelta = new Prisma.Decimal(tipAmount ?? 0);

    if (tipDelta.lt(0)) {
      throw new BadRequestException('La propina no puede ser negativa.');
    }

    return tipDelta;
  }

  private async resolveRedirectGateway(
    restaurantId: string,
    provider: PaymentGatewayProvider,
  ): Promise<ResolvedPaymentGateway> {
    const availableGateways =
      await this.paymentGatewayResolver.resolveAvailable(restaurantId);
    const resolvedGateway = availableGateways.find(
      (candidate) =>
        candidate.provider === provider &&
        candidate.checkoutMode === 'redirect',
    );

    if (!resolvedGateway) {
      throw new ConflictException(NO_REDIRECT_GATEWAY_FAILURE_REASON);
    }

    return resolvedGateway;
  }

  private async beginRedirect(
    resolvedGateway: ResolvedPaymentGateway,
    restaurantId: string,
    attemptId: string,
    amount: Prisma.Decimal,
    currency: string,
    description: string,
  ): Promise<RedirectPaymentResponseDto> {
    const outcome = await resolvedGateway.gateway.charge({
      restaurantId,
      attemptId,
      amount,
      currency,
      description,
      externalReference: attemptId,
      credentials: resolvedGateway.credentials,
    });

    return this.applyChargeOutcome(resolvedGateway, attemptId, outcome);
  }

  private async applyChargeOutcome(
    resolvedGateway: ResolvedPaymentGateway,
    attemptId: string,
    outcome: GatewayChargeOutcome,
  ): Promise<RedirectPaymentResponseDto> {
    switch (outcome.kind) {
      case 'REDIRECT': {
        await this.prisma.paymentAttempt.update({
          where: { id: attemptId },
          data: { providerReference: outcome.providerReference },
        });

        return {
          attemptId,
          provider: resolvedGateway.provider,
          redirectUrl: outcome.redirectUrl,
          method: outcome.method,
          fields: outcome.fields,
          expiresAt: outcome.expiresAt.toISOString(),
        };
      }
      case 'SETTLED': {
        const failureReason =
          outcome.result === 'REJECTED'
            ? (outcome.failureReason ?? GENERIC_REJECTED_FAILURE_REASON)
            : UNEXPECTED_SETTLEMENT_FAILURE_REASON;

        await this.failPaymentService.execute(this.prisma, {
          attemptId,
          providerReference: outcome.providerReference,
          failureReason,
        });

        throw new ConflictException(failureReason);
      }
      default:
        return assertNever(outcome);
    }
  }
}

import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  OrderStatus,
  PaymentAttemptStatus,
  Prisma,
  TableStatus,
} from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { applyOrderChargeToBill } from '../../orders/application/apply-order-charge-to-bill';
import { routeOrderToStations } from '../../orders/application/route-order-to-stations';
import { applyPaymentToBill } from './apply-payment-to-bill';
import { buildCheckoutFromDto } from './build-checkout-from-dto';
import { ChargePaymentService } from './charge-payment.service';
import { PaymentChannel } from '../domain/payment-channel';
import { FailPaymentService } from './fail-payment.service';
import { FinalizePaymentService } from './finalize-payment.service';
import { mapPaymentResult } from './payment-result-mapper';
import {
  OFFLINE_PAYMENT_RECORDER,
  type OfflinePaymentRecorderPort,
} from './ports/offline-payment-recorder.port';
import { requireSettledCharge } from './require-settled-charge';
import type {
  PayQrOrderDto,
  PaymentResultResponseDto,
} from '../presentation/http/dto/payments.dto';

const PAYABLE_ORDER_STATUSES: OrderStatus[] = [
  OrderStatus.AWAITING_PAYMENT,
  OrderStatus.PAYMENT_FAILED,
];

@Injectable()
export class PayQrOrderService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(OFFLINE_PAYMENT_RECORDER)
    private readonly offlinePaymentRecorder: OfflinePaymentRecorderPort,
    private readonly chargePaymentService: ChargePaymentService,
    private readonly finalizePaymentService: FinalizePaymentService,
    private readonly failPaymentService: FailPaymentService,
  ) {}
  async execute(
    qrToken: string,
    orderId: string,
    dto: PayQrOrderDto,
  ): Promise<PaymentResultResponseDto> {
    const table = await this.prisma.table.findUnique({
      where: {
        qrToken,
      },
    });

    if (!table || table.status === TableStatus.DISABLED) {
      throw new NotFoundException('El QR indicado no esta disponible.');
    }

    const order = await this.prisma.order.findUnique({
      where: {
        id: orderId,
      },
      include: {
        orderItems: true,
        tableSession: true,
        branch: {
          include: {
            restaurant: true,
          },
        },
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

    const tipDelta = new Prisma.Decimal(dto.tipAmount ?? 0);

    if (tipDelta.lt(0)) {
      throw new BadRequestException('La propina no puede ser negativa.');
    }

    const checkout = buildCheckoutFromDto(dto);

    const orderAmount = order.orderItems.reduce(
      (total, item) => total.add(item.priceSnapshot.mul(item.quantity)),
      new Prisma.Decimal(0),
    );
    const paidAmount = orderAmount.add(tipDelta);
    const currency = order.branch.restaurant.currency;

    const attempt = await this.prisma.paymentAttempt.create({
      data: {
        orderId: order.id,
        billId: order.billId,
        amount: paidAmount,
        provider: this.offlinePaymentRecorder.providerName,
        status: PaymentAttemptStatus.PENDING,
      },
    });

    const chargeResult = requireSettledCharge(
      await this.chargePaymentService.execute({
        channel: PaymentChannel.QR_ONLINE,
        restaurantId: order.branch.restaurantId,
        attemptId: attempt.id,
        amount: paidAmount,
        currency,
        description: `Orden QR ${order.id}`,
        checkout,
      }),
    );

    if (!chargeResult.approved) {
      await this.prisma.$transaction(async (tx) => {
        await this.failPaymentService.execute(tx, {
          attemptId: attempt.id,
          providerReference: chargeResult.providerReference,
          failureReason:
            chargeResult.failureReason ?? 'Pago rechazado por el proveedor.',
        });

        await tx.order.update({
          where: {
            id: order.id,
          },
          data: {
            status: OrderStatus.PAYMENT_FAILED,
          },
        });
      });

      throw new ConflictException(
        'El pago fue rechazado por el proveedor. Puedes reintentarlo.',
      );
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const currentOrder = await tx.order.findUniqueOrThrow({
        where: {
          id: order.id,
        },
      });

      if (!PAYABLE_ORDER_STATUSES.includes(currentOrder.status)) {
        throw new ConflictException('La orden ya fue pagada o cancelada.');
      }

      const payment = await this.finalizePaymentService.execute(tx, {
        attemptId: attempt.id,
        billId: order.billId,
        amount: paidAmount,
        currency,
        provider: chargeResult.providerName,
        providerReference: chargeResult.providerReference,
      });

      const bill = await tx.bill.findUniqueOrThrow({
        where: {
          id: order.billId,
        },
      });

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
        order.billId,
        paidAmount,
        tipDelta,
      );

      await routeOrderToStations(
        tx,
        { id: order.id, branchId: order.branchId },
        chargeItems,
      );

      const updatedOrder = await tx.order.update({
        where: {
          id: order.id,
        },
        data: {
          status: OrderStatus.ROUTED,
        },
      });

      return { payment, billAfterPayment, updatedOrder };
    });

    return mapPaymentResult(result.payment, result.billAfterPayment, {
      orderId: result.updatedOrder.id,
      status: result.updatedOrder.status,
    });
  }
}

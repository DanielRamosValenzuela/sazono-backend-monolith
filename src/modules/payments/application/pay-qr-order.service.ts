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
  PaymentStatus,
  Prisma,
  TableStatus,
} from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { applyOrderChargeToBill } from '../../orders/application/apply-order-charge-to-bill';
import { routeOrderToStations } from '../../orders/application/route-order-to-stations';
import { applyPaymentToBill } from './apply-payment-to-bill';
import {
  PAYMENT_PROVIDER,
  type PaymentProviderPort,
} from './ports/payment-provider.port';
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
    @Inject(PAYMENT_PROVIDER)
    private readonly paymentProvider: PaymentProviderPort,
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
        provider: this.paymentProvider.providerName,
        status: PaymentAttemptStatus.PENDING,
      },
    });

    const chargeResult = await this.paymentProvider.charge({
      amount: paidAmount,
      currency,
      description: `Orden QR ${order.id}`,
    });

    if (!chargeResult.approved) {
      await this.prisma.$transaction([
        this.prisma.paymentAttempt.update({
          where: {
            id: attempt.id,
          },
          data: {
            status: PaymentAttemptStatus.FAILED,
            providerReference: chargeResult.providerReference ?? null,
            failureReason:
              chargeResult.failureReason ?? 'Pago rechazado por el proveedor.',
          },
        }),
        this.prisma.order.update({
          where: {
            id: order.id,
          },
          data: {
            status: OrderStatus.PAYMENT_FAILED,
          },
        }),
      ]);

      throw new ConflictException(
        'El pago fue rechazado por el proveedor. Puedes reintentarlo.',
      );
    }

    const paidAt = new Date();

    const result = await this.prisma.$transaction(async (tx) => {
      const currentOrder = await tx.order.findUniqueOrThrow({
        where: {
          id: order.id,
        },
      });

      if (!PAYABLE_ORDER_STATUSES.includes(currentOrder.status)) {
        throw new ConflictException('La orden ya fue pagada o cancelada.');
      }

      await tx.paymentAttempt.update({
        where: {
          id: attempt.id,
        },
        data: {
          status: PaymentAttemptStatus.SUCCEEDED,
          providerReference: chargeResult.providerReference ?? null,
        },
      });

      const payment = await tx.payment.create({
        data: {
          billId: order.billId,
          amount: paidAmount,
          currency,
          provider: this.paymentProvider.providerName,
          providerReference: chargeResult.providerReference ?? null,
          status: PaymentStatus.PAID,
          paidAt,
        },
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

    return {
      paymentId: result.payment.id,
      billId: result.payment.billId,
      amount: result.payment.amount.toString(),
      currency: result.payment.currency,
      provider: result.payment.provider,
      providerReference: result.payment.providerReference,
      status: result.payment.status,
      paidAt: result.payment.paidAt?.toISOString() ?? null,
      bill: {
        billId: result.billAfterPayment.billId,
        status: result.billAfterPayment.status,
        subtotalAmount: result.billAfterPayment.subtotalAmount.toString(),
        tipAmount: result.billAfterPayment.tipAmount.toString(),
        totalAmount: result.billAfterPayment.totalAmount.toString(),
        remainingAmount: result.billAfterPayment.remainingAmount.toString(),
      },
      order: {
        orderId: result.updatedOrder.id,
        status: result.updatedOrder.status,
      },
    };
  }
}

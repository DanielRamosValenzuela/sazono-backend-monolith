import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import {
  BillItemStatus,
  BillStatus,
  OrderItemStatus,
  OrderStatus,
  PaymentPolicy,
  Prisma,
  Role,
  StationTicketStatus,
} from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type { JwtPayload } from '../../auth/interfaces/jwt-payload.interface';
import { computeBillTotals } from '../../billing/domain/tax-policy';
import { ORDER_INCLUDE, mapOrder } from './order-mapper';
import { OrdersBranchAccessService } from './orders-branch-access.service';
import type {
  CancelOrderDto,
  OrderResponseDto,
} from '../presentation/http/dto/orders.dto';
const PRE_PRODUCTION_STATUSES: OrderStatus[] = [
  OrderStatus.DRAFT,
  OrderStatus.AWAITING_PAYMENT,
  OrderStatus.PAYMENT_FAILED,
];

const QUEUED_NOT_STARTED_STATUSES: OrderStatus[] = [
  OrderStatus.CONFIRMED,
  OrderStatus.ROUTED,
];

const IN_PRODUCTION_STATUSES: OrderStatus[] = [
  OrderStatus.IN_PREPARATION,
  OrderStatus.PARTIALLY_READY,
  OrderStatus.READY,
];

@Injectable()
export class CancelOrderService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ordersBranchAccessService: OrdersBranchAccessService,
  ) {}

  async execute(
    authUser: JwtPayload,
    orderId: string,
    dto: CancelOrderDto,
  ): Promise<OrderResponseDto> {
    const order = await this.prisma.order.findUnique({
      where: {
        id: orderId,
      },
      include: {
        orderItems: true,
      },
    });

    if (!order) {
      throw new BadRequestException('La orden indicada no existe.');
    }

    const context = await this.ordersBranchAccessService.ensureAccess(
      authUser,
      order.branchId,
      [Role.ADMIN, Role.SUPERVISOR, Role.WAITER, Role.CASHIER],
    );

    const reason = dto.reason?.trim() || null;

    const isQueuedNotStarted = QUEUED_NOT_STARTED_STATUSES.includes(
      order.status,
    );
    const isInProduction = IN_PRODUCTION_STATUSES.includes(order.status);

    if (PRE_PRODUCTION_STATUSES.includes(order.status)) {
      await this.cancelPreProductionOrder(order.id, reason);
    } else if (isQueuedNotStarted || isInProduction) {
      if (isInProduction) {
        const isSupervisor =
          context.roles.includes(Role.ADMIN) ||
          context.roles.includes(Role.SUPERVISOR);

        if (!isSupervisor) {
          throw new ForbiddenException(
            'Una orden en produccion solo puede anularla un supervisor o admin.',
          );
        }
      }

      if (order.paymentPolicy === PaymentPolicy.PREPAID) {
        throw new ConflictException(
          'Una orden prepagada requiere reembolso y no puede anularse desde aqui.',
        );
      }

      await this.cancelInProductionOrder(order, reason);
    } else {
      throw new ConflictException(
        'La orden indicada ya fue entregada o cancelada.',
      );
    }

    const cancelledOrder = await this.prisma.order.findUniqueOrThrow({
      where: {
        id: order.id,
      },
      include: ORDER_INCLUDE,
    });

    return mapOrder(cancelledOrder);
  }
  private async cancelPreProductionOrder(
    orderId: string,
    reason: string | null,
  ): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.order.update({
        where: {
          id: orderId,
        },
        data: {
          status: OrderStatus.CANCELLED,
          ...(reason ? { notes: reason } : {}),
        },
      }),
      this.prisma.orderItem.updateMany({
        where: {
          orderId,
        },
        data: {
          status: OrderItemStatus.CANCELLED,
        },
      }),
    ]);
  }
  private async cancelInProductionOrder(
    order: {
      id: string;
      billId: string;
      orderItems: Array<{ id: string }>;
    },
    reason: string | null,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const orderItemIds = order.orderItems.map((item) => item.id);

      await tx.billItem.updateMany({
        where: {
          billId: order.billId,
          orderItemId: {
            in: orderItemIds,
          },
          status: BillItemStatus.OPEN,
        },
        data: {
          status: BillItemStatus.VOID,
        },
      });

      const bill = await tx.bill.findUniqueOrThrow({
        where: {
          id: order.billId,
        },
      });

      const openBillItems = await tx.billItem.findMany({
        where: {
          billId: order.billId,
          status: BillItemStatus.OPEN,
        },
        select: {
          totalPrice: true,
        },
      });

      const subtotalAmount = openBillItems.reduce(
        (total, item) => total.add(item.totalPrice),
        new Prisma.Decimal(0),
      );
      const { taxAmount, totalAmount } = computeBillTotals(
        subtotalAmount,
        bill.tipAmount,
      );
      const paidAmount = bill.totalAmount.sub(bill.remainingAmount);
      const remainingAmount = totalAmount.sub(paidAmount);

      if (remainingAmount.lt(0)) {
        throw new ConflictException(
          'La cuenta ya tiene pagos que cubren esta orden: anularla requiere reembolso.',
        );
      }

      const status = paidAmount.lte(0)
        ? BillStatus.OPEN
        : remainingAmount.lte(0)
          ? BillStatus.PAID
          : BillStatus.PARTIALLY_PAID;

      await tx.bill.update({
        where: {
          id: bill.id,
        },
        data: {
          subtotalAmount,
          taxAmount,
          totalAmount,
          remainingAmount,
          status,
        },
      });

      await tx.stationTicket.updateMany({
        where: {
          orderId: order.id,
          status: {
            not: StationTicketStatus.CANCELLED,
          },
        },
        data: {
          status: StationTicketStatus.CANCELLED,
        },
      });

      await tx.stationTicketItem.updateMany({
        where: {
          orderItemId: {
            in: orderItemIds,
          },
        },
        data: {
          status: OrderItemStatus.CANCELLED,
        },
      });

      await tx.orderItem.updateMany({
        where: {
          orderId: order.id,
        },
        data: {
          status: OrderItemStatus.CANCELLED,
        },
      });

      await tx.order.update({
        where: {
          id: order.id,
        },
        data: {
          status: OrderStatus.CANCELLED,
          ...(reason ? { notes: reason } : {}),
        },
      });
    });
  }
}

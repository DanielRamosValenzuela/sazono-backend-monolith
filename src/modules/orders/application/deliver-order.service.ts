import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { OrderItemStatus, OrderStatus, Role } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type { JwtPayload } from '../../auth/interfaces/jwt-payload.interface';
import { ORDER_INCLUDE, mapOrder } from './order-mapper';
import { BranchAccessService } from '../../../common/branch-access/branch-access.service';
import type { OrderResponseDto } from '../presentation/http/dto/orders.dto';

@Injectable()
export class DeliverOrderService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly branchAccessService: BranchAccessService,
  ) {}
  async execute(
    authUser: JwtPayload,
    orderId: string,
  ): Promise<OrderResponseDto> {
    const order = await this.prisma.order.findUnique({
      where: {
        id: orderId,
      },
    });

    if (!order) {
      throw new BadRequestException('La orden indicada no existe.');
    }

    await this.branchAccessService.ensureAccess(
      authUser,
      order.branchId,
      [Role.ADMIN, Role.SUPERVISOR, Role.CASHIER],
    );

    if (order.status !== OrderStatus.READY) {
      throw new ConflictException(
        'Solo se puede entregar una orden cuando todas sus estaciones la marcaron lista.',
      );
    }

    await this.prisma.$transaction([
      this.prisma.order.update({
        where: {
          id: order.id,
        },
        data: {
          status: OrderStatus.DELIVERED,
        },
      }),
      this.prisma.orderItem.updateMany({
        where: {
          orderId: order.id,
          status: {
            not: OrderItemStatus.CANCELLED,
          },
        },
        data: {
          status: OrderItemStatus.DELIVERED,
        },
      }),
    ]);

    const deliveredOrder = await this.prisma.order.findUniqueOrThrow({
      where: {
        id: order.id,
      },
      include: ORDER_INCLUDE,
    });

    return mapOrder(deliveredOrder);
  }
}

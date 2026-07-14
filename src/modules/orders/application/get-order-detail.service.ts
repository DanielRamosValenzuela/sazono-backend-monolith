import { BadRequestException, Injectable } from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type { JwtPayload } from '../../auth/interfaces/jwt-payload.interface';
import { ORDER_INCLUDE, mapOrder } from './order-mapper';
import { BranchAccessService } from '../../../common/branch-access/branch-access.service';
import type { OrderResponseDto } from '../presentation/http/dto/orders.dto';

@Injectable()
export class GetOrderDetailService {
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
      include: ORDER_INCLUDE,
    });

    if (!order) {
      throw new BadRequestException('La orden indicada no existe.');
    }

    await this.branchAccessService.ensureAccess(authUser, order.branchId, [
      Role.ADMIN,
      Role.SUPERVISOR,
      Role.WAITER,
      Role.CASHIER,
      Role.KITCHEN,
      Role.BAR,
    ]);

    return mapOrder(order);
  }
}

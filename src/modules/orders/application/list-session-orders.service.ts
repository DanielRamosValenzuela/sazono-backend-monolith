import { BadRequestException, Injectable } from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type { JwtPayload } from '../../auth/interfaces/jwt-payload.interface';
import { ORDER_INCLUDE, mapOrder } from './order-mapper';
import { OrdersBranchAccessService } from './orders-branch-access.service';
import type {
  ListOrdersQueryDto,
  OrderResponseDto,
} from '../presentation/http/dto/orders.dto';

@Injectable()
export class ListSessionOrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ordersBranchAccessService: OrdersBranchAccessService,
  ) {}

  async execute(
    authUser: JwtPayload,
    query: ListOrdersQueryDto,
  ): Promise<OrderResponseDto[]> {
    const tableSession = await this.prisma.tableSession.findUnique({
      where: {
        id: query.tableSessionId,
      },
    });

    if (!tableSession) {
      throw new BadRequestException('La sesion indicada no existe.');
    }

    await this.ordersBranchAccessService.ensureAccess(
      authUser,
      tableSession.branchId,
      [
        Role.ADMIN,
        Role.SUPERVISOR,
        Role.WAITER,
        Role.CASHIER,
        Role.KITCHEN,
        Role.BAR,
      ],
    );

    const orders = await this.prisma.order.findMany({
      where: {
        tableSessionId: tableSession.id,
      },
      orderBy: [{ createdAt: 'asc' }],
      include: ORDER_INCLUDE,
    });

    return orders.map(mapOrder);
  }
}

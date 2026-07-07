import { Injectable, NotFoundException } from '@nestjs/common';
import { TableStatus } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { ACTIVE_TABLE_SESSION_STATUSES } from '../../floor/domain/active-table-session-statuses';
import { ORDER_INCLUDE, mapOrder } from './order-mapper';
import type { OrderResponseDto } from '../presentation/http/dto/orders.dto';

@Injectable()
export class ListQrSessionOrdersService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Lista las ordenes de la sesion activa de la mesa asociada al QR.
   * Permite al cliente final ver el estado general de sus pedidos.
   */
  async execute(qrToken: string): Promise<OrderResponseDto[]> {
    const table = await this.prisma.table.findUnique({
      where: {
        qrToken,
      },
    });

    if (!table || table.status === TableStatus.DISABLED) {
      throw new NotFoundException('El QR indicado no esta disponible.');
    }

    const activeSession = await this.prisma.tableSession.findFirst({
      where: {
        tableId: table.id,
        status: {
          in: ACTIVE_TABLE_SESSION_STATUSES,
        },
      },
    });

    if (!activeSession) {
      return [];
    }

    const orders = await this.prisma.order.findMany({
      where: {
        tableSessionId: activeSession.id,
      },
      orderBy: [{ createdAt: 'asc' }],
      include: ORDER_INCLUDE,
    });

    return orders.map(mapOrder);
  }
}

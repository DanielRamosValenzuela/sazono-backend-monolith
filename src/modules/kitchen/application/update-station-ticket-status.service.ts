import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import {
  OrderItemStatus,
  OrderStatus,
  Role,
  StationTicketStatus,
} from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type { JwtPayload } from '../../auth/interfaces/jwt-payload.interface';
import { computeOrderStatusFromTickets } from '../../orders/domain/order-status-from-tickets';
import { canTransitionStationTicket } from '../domain/station-ticket-transitions';
import { BranchAccessService } from '../../../common/branch-access/branch-access.service';
import {
  STATION_TICKET_INCLUDE,
  mapStationTicket,
} from './station-ticket-mapper';
import type {
  StationTicketResponseDto,
  UpdateStationTicketStatusDto,
} from '../presentation/http/dto/kitchen.dto';

const ORDER_PRODUCTION_STATUSES: OrderStatus[] = [
  OrderStatus.ROUTED,
  OrderStatus.IN_PREPARATION,
  OrderStatus.PARTIALLY_READY,
  OrderStatus.READY,
];

const ORDER_ITEM_STATUS_BY_TICKET_STATUS: Partial<
  Record<StationTicketStatus, OrderItemStatus>
> = {
  [StationTicketStatus.IN_PROGRESS]: OrderItemStatus.IN_PREPARATION,
  [StationTicketStatus.READY]: OrderItemStatus.READY,
  [StationTicketStatus.CANCELLED]: OrderItemStatus.CANCELLED,
};

@Injectable()
export class UpdateStationTicketStatusService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly branchAccessService: BranchAccessService,
  ) {}

  async execute(
    authUser: JwtPayload,
    stationTicketId: string,
    dto: UpdateStationTicketStatusDto,
  ): Promise<StationTicketResponseDto> {
    const ticket = await this.prisma.stationTicket.findUnique({
      where: {
        id: stationTicketId,
      },
      include: {
        order: true,
      },
    });

    if (!ticket) {
      throw new BadRequestException('El ticket indicado no existe.');
    }

    const context = await this.branchAccessService.ensureAccess(
      authUser,
      ticket.branchId,
      [Role.ADMIN, Role.SUPERVISOR, Role.KITCHEN, Role.BAR],
    );

    if (
      dto.status === StationTicketStatus.CANCELLED &&
      !context.roles.includes(Role.ADMIN) &&
      !context.roles.includes(Role.SUPERVISOR)
    ) {
      throw new ForbiddenException(
        'Solo un supervisor o admin puede cancelar un ticket de estacion.',
      );
    }

    if (!canTransitionStationTicket(ticket.status, dto.status)) {
      throw new ConflictException(
        `No se puede pasar un ticket de ${ticket.status} a ${dto.status}.`,
      );
    }

    await this.prisma.$transaction(async (tx) => {
      const now = new Date();

      await tx.stationTicket.update({
        where: {
          id: ticket.id,
        },
        data: {
          status: dto.status,
          ...(dto.status === StationTicketStatus.IN_PROGRESS
            ? { startedAt: ticket.startedAt ?? now }
            : {}),
          ...(dto.status === StationTicketStatus.READY
            ? { completedAt: now }
            : {}),
        },
      });

      const orderItemStatus = ORDER_ITEM_STATUS_BY_TICKET_STATUS[dto.status];

      if (orderItemStatus) {
        await tx.stationTicketItem.updateMany({
          where: {
            stationTicketId: ticket.id,
          },
          data: {
            status: orderItemStatus,
          },
        });

        const ticketItems = await tx.stationTicketItem.findMany({
          where: {
            stationTicketId: ticket.id,
          },
          select: {
            orderItemId: true,
          },
        });

        await tx.orderItem.updateMany({
          where: {
            id: {
              in: ticketItems.map((item) => item.orderItemId),
            },
          },
          data: {
            status: orderItemStatus,
          },
        });
      }

      if (ORDER_PRODUCTION_STATUSES.includes(ticket.order.status)) {
        const orderTickets = await tx.stationTicket.findMany({
          where: {
            orderId: ticket.orderId,
          },
          select: {
            status: true,
          },
        });

        const nextOrderStatus = computeOrderStatusFromTickets(
          orderTickets.map((orderTicket) => orderTicket.status),
        );

        if (nextOrderStatus && nextOrderStatus !== ticket.order.status) {
          await tx.order.update({
            where: {
              id: ticket.orderId,
            },
            data: {
              status: nextOrderStatus,
            },
          });
        }
      }
    });

    const updatedTicket = await this.prisma.stationTicket.findUniqueOrThrow({
      where: {
        id: ticket.id,
      },
      include: STATION_TICKET_INCLUDE,
    });

    return mapStationTicket(updatedTicket);
  }
}

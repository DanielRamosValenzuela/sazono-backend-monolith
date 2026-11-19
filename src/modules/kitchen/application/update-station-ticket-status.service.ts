import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
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
import { STATION_TICKET_READY_EVENT } from '../domain/station-ticket-events';
import type { StationTicketReadyEvent } from '../domain/station-ticket-events';
import { BranchAccessService } from '../../../common/branch-access/branch-access.service';
import { AuditService } from '../../../common/audit/audit.service';
import { isStationTicketReturn } from '../domain/station-ticket-transitions';
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
  [StationTicketStatus.PENDING]: OrderItemStatus.PENDING,
  [StationTicketStatus.IN_PROGRESS]: OrderItemStatus.IN_PREPARATION,
  [StationTicketStatus.READY]: OrderItemStatus.READY,
  [StationTicketStatus.CANCELLED]: OrderItemStatus.CANCELLED,
};

@Injectable()
export class UpdateStationTicketStatusService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly branchAccessService: BranchAccessService,
    private readonly eventEmitter: EventEmitter2,
    private readonly auditService: AuditService,
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

    const isReturn = isStationTicketReturn(ticket.status, dto.status);

    if (isReturn && !ORDER_PRODUCTION_STATUSES.includes(ticket.order.status)) {
      throw new ConflictException(
        'El pedido ya fue entregado o cerrado; no se puede devolver el ticket.',
      );
    }

    const actorRole = context.roles.includes(Role.ADMIN)
      ? Role.ADMIN
      : context.roles.includes(Role.SUPERVISOR)
        ? Role.SUPERVISOR
        : context.roles.includes(Role.KITCHEN)
          ? Role.KITCHEN
          : context.roles.includes(Role.BAR)
            ? Role.BAR
            : null;

    let finalOrderStatus = ticket.order.status;
    let alreadyApplied = false;

    await this.prisma.$transaction(async (tx) => {
      const now = new Date();

      const lockedOrder = await tx.order.update({
        where: { id: ticket.orderId },
        data: { updatedAt: now },
        select: { status: true },
      });

      finalOrderStatus = lockedOrder.status;

      const { count } = await tx.stationTicket.updateMany({
        where: {
          id: ticket.id,
          status: ticket.status,
        },
        data: {
          status: dto.status,
          ...(dto.status === StationTicketStatus.PENDING
            ? { startedAt: null, completedAt: null }
            : {}),
          ...(dto.status === StationTicketStatus.IN_PROGRESS
            ? { startedAt: ticket.startedAt ?? now, completedAt: null }
            : {}),
          ...(dto.status === StationTicketStatus.READY
            ? { completedAt: now }
            : {}),
        },
      });

      if (count === 0) {
        const current = await tx.stationTicket.findUnique({
          where: { id: ticket.id },
          select: { status: true },
        });

        if (current?.status !== dto.status) {
          throw new ConflictException(
            'El ticket cambio de estado mientras tanto.',
          );
        }

        alreadyApplied = true;
        return;
      }

      if (isReturn || dto.status === StationTicketStatus.CANCELLED) {
        await this.auditService.record(tx, {
          restaurantId: context.restaurantId,
          branchId: ticket.branchId,
          actorStaffUserId: context.staffUserId,
          actorRole,
          action: isReturn
            ? 'STATION_TICKET_RETURNED'
            : 'STATION_TICKET_CANCELLED',
          entityType: 'StationTicket',
          entityId: ticket.id,
          before: { status: ticket.status },
          after: { status: dto.status },
        });
      }

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

      if (ORDER_PRODUCTION_STATUSES.includes(lockedOrder.status)) {
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

        if (nextOrderStatus) {
          finalOrderStatus = nextOrderStatus;
        }

        if (nextOrderStatus && nextOrderStatus !== lockedOrder.status) {
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

    if (
      !alreadyApplied &&
      dto.status === StationTicketStatus.READY &&
      finalOrderStatus === OrderStatus.READY
    ) {
      const { tableSession } = updatedTicket.order;
      const event: StationTicketReadyEvent = {
        orderId: updatedTicket.orderId,
        createdByStaffUserId: updatedTicket.order.createdByStaffUserId,
        branchId: updatedTicket.branchId,
        label: tableSession.isCounter
          ? [`#${tableSession.ticketNumber}`, tableSession.customerLabel]
              .filter(Boolean)
              .join(' ')
          : tableSession.table.code,
        isCounter: tableSession.isCounter,
        openedByStaffUserId: tableSession.openedByStaffUserId,
      };

      this.eventEmitter.emit(STATION_TICKET_READY_EVENT, event);
    }

    return mapStationTicket(updatedTicket);
  }
}

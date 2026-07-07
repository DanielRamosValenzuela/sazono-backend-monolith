import {
  OrderItemStatus,
  OrderSource,
  Prisma,
  PreparationStationType,
  StationTicketStatus,
} from '@prisma/client';
import type { StationTicketResponseDto } from '../presentation/http/dto/kitchen.dto';

export type StationTicketWithRelations = {
  id: string;
  orderId: string;
  branchId: string;
  preparationStationId: string;
  status: StationTicketStatus;
  sentAt: Date | null;
  startedAt: Date | null;
  completedAt: Date | null;
  preparationStation: {
    name: string;
    stationType: PreparationStationType;
  };
  order: {
    source: OrderSource;
    notes: string | null;
    tableSession: {
      table: {
        code: string;
      };
    };
  };
  stationTicketItems: Array<{
    id: string;
    orderItemId: string;
    quantity: number;
    status: OrderItemStatus;
    orderItem: {
      nameSnapshot: string;
      notes: string | null;
    };
  }>;
};

export const STATION_TICKET_INCLUDE = {
  preparationStation: true,
  order: {
    include: {
      tableSession: {
        include: {
          table: true,
        },
      },
    },
  },
  stationTicketItems: {
    orderBy: [{ createdAt: 'asc' as const }],
    include: {
      orderItem: true,
    },
  },
} satisfies Prisma.StationTicketInclude;

export const mapStationTicket = (
  ticket: StationTicketWithRelations,
): StationTicketResponseDto => ({
  stationTicketId: ticket.id,
  orderId: ticket.orderId,
  branchId: ticket.branchId,
  preparationStationId: ticket.preparationStationId,
  stationName: ticket.preparationStation.name,
  stationType: ticket.preparationStation.stationType,
  status: ticket.status,
  orderSource: ticket.order.source,
  tableCode: ticket.order.tableSession.table.code,
  orderNotes: ticket.order.notes,
  sentAt: ticket.sentAt?.toISOString() ?? null,
  startedAt: ticket.startedAt?.toISOString() ?? null,
  completedAt: ticket.completedAt?.toISOString() ?? null,
  items: ticket.stationTicketItems.map((item) => ({
    stationTicketItemId: item.id,
    orderItemId: item.orderItemId,
    name: item.orderItem.nameSnapshot,
    quantity: item.quantity,
    status: item.status,
    notes: item.orderItem.notes,
  })),
});

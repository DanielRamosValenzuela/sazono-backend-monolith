import type {
  OrderItemStatus,
  OrderSource,
  Prisma,
  PreparationStationType,
  StationTicketStatus,
} from '@prisma/client';
import { COUNTER_TABLE_CODE } from '../../floor/domain/counter-table';
import { formatModifierLines } from '../../orders/domain/modifier-lines';
import type {
  StationTicketPrintDto,
  StationTicketResponseDto,
} from '../presentation/http/dto/kitchen.dto';

export type StationTicketWithRelations = {
  id: string;
  orderId: string;
  branchId: string;
  preparationStationId: string;
  status: StationTicketStatus;
  displayNumber?: string | null;
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
      isCounter: boolean;
      ticketNumber: number | null;
      customerLabel: string | null;
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
      modifiers: Array<{
        id: string;
        parentOrderItemModifierId: string | null;
        depth: number;
        pathSnapshot: string[];
        nameSnapshot: string;
      }>;
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
      orderItem: {
        include: {
          modifiers: {
            orderBy: [
              { depth: 'asc' as const },
              { createdAt: 'asc' as const },
              { id: 'asc' as const },
            ],
          },
        },
      },
    },
  },
} satisfies Prisma.StationTicketInclude;

export const mapStationTicket = (
  ticket: StationTicketWithRelations,
  print: StationTicketPrintDto = {
    status: 'NONE',
    lastJobId: null,
    printerOffline: false,
  },
): StationTicketResponseDto => ({
  stationTicketId: ticket.id,
  orderId: ticket.orderId,
  branchId: ticket.branchId,
  preparationStationId: ticket.preparationStationId,
  stationName: ticket.preparationStation.name,
  stationType: ticket.preparationStation.stationType,
  status: ticket.status,
  displayNumber: ticket.displayNumber ?? null,
  print,
  orderSource: ticket.order.source,
  tableCode: ticket.order.tableSession.isCounter
    ? COUNTER_TABLE_CODE
    : ticket.order.tableSession.table.code,
  isCounter: ticket.order.tableSession.isCounter,
  ticketNumber: ticket.order.tableSession.ticketNumber,
  customerLabel: ticket.order.tableSession.customerLabel,
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
    modifiers: formatModifierLines(item.orderItem.modifiers),
  })),
});

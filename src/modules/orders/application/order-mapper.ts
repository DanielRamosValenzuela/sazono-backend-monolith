import {
  OrderItemStatus,
  OrderSource,
  OrderStatus,
  PaymentPolicy,
  PreparationStationStatus,
  PreparationStationType,
  Prisma,
  StationTicketStatus,
} from '@prisma/client';
import type { OrderResponseDto } from '../presentation/http/dto/orders.dto';

export type OrderWithRelations = {
  id: string;
  tableSessionId: string;
  billId: string;
  branchId: string;
  source: OrderSource;
  paymentPolicy: PaymentPolicy;
  status: OrderStatus;
  notes: string | null;
  submittedAt: Date | null;
  createdAt: Date;
  orderItems: Array<{
    id: string;
    menuItemId: string | null;
    nameSnapshot: string;
    priceSnapshot: Prisma.Decimal;
    quantity: number;
    status: OrderItemStatus;
    notes: string | null;
    preparationStation: {
      id: string;
      name: string;
      stationType: PreparationStationType;
      status: PreparationStationStatus;
    };
  }>;
  stationTickets: Array<{
    id: string;
    preparationStationId: string;
    status: StationTicketStatus;
    sentAt: Date | null;
    preparationStation: {
      name: string;
      stationType: PreparationStationType;
    };
  }>;
};

export const ORDER_INCLUDE = {
  orderItems: {
    orderBy: [{ createdAt: 'asc' as const }],
    include: {
      preparationStation: true,
    },
  },
  stationTickets: {
    orderBy: [{ createdAt: 'asc' as const }],
    include: {
      preparationStation: true,
    },
  },
} satisfies Prisma.OrderInclude;

export const mapOrder = (order: OrderWithRelations): OrderResponseDto => {
  const orderTotalAmount = order.orderItems.reduce(
    (total, item) => total.add(item.priceSnapshot.mul(item.quantity)),
    new Prisma.Decimal(0),
  );

  return {
    orderId: order.id,
    tableSessionId: order.tableSessionId,
    billId: order.billId,
    branchId: order.branchId,
    source: order.source,
    paymentPolicy: order.paymentPolicy,
    status: order.status,
    notes: order.notes,
    submittedAt: order.submittedAt?.toISOString() ?? null,
    createdAt: order.createdAt.toISOString(),
    orderTotalAmount: orderTotalAmount.toString(),
    items: order.orderItems.map((item) => ({
      orderItemId: item.id,
      menuItemId: item.menuItemId,
      name: item.nameSnapshot,
      unitPrice: item.priceSnapshot.toString(),
      quantity: item.quantity,
      totalPrice: item.priceSnapshot.mul(item.quantity).toString(),
      status: item.status,
      notes: item.notes,
      preparationStation: {
        preparationStationId: item.preparationStation.id,
        name: item.preparationStation.name,
        stationType: item.preparationStation.stationType,
        status: item.preparationStation.status,
      },
    })),
    stationTickets: order.stationTickets.map((ticket) => ({
      stationTicketId: ticket.id,
      preparationStationId: ticket.preparationStationId,
      stationName: ticket.preparationStation.name,
      stationType: ticket.preparationStation.stationType,
      status: ticket.status,
      sentAt: ticket.sentAt?.toISOString() ?? null,
    })),
  };
};

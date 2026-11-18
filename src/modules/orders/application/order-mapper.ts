import type {
  OrderItemStatus,
  OrderSource,
  OrderStatus,
  PaymentPolicy,
  PreparationStationStatus,
  PreparationStationType,
  StationTicketStatus,
} from '@prisma/client';
import { Prisma } from '@prisma/client';
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
    modifiers: Array<{
      id: string;
      modifierOptionId: string | null;
      parentOrderItemModifierId: string | null;
      depth: number;
      pathSnapshot: string[];
      nameSnapshot: string;
      priceDeltaSnapshot: Prisma.Decimal;
    }>;
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
      modifiers: {
        orderBy: [
          { depth: 'asc' as const },
          { createdAt: 'asc' as const },
          { id: 'asc' as const },
        ],
      },
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
      modifiers: item.modifiers.map((modifier) => ({
        modifierOptionId: modifier.modifierOptionId,
        parentModifierOptionId:
          item.modifiers.find(
            (row) => row.id === modifier.parentOrderItemModifierId,
          )?.modifierOptionId ?? null,
        depth: modifier.depth,
        path:
          modifier.pathSnapshot.length > 0
            ? modifier.pathSnapshot
            : [modifier.nameSnapshot],
        name: modifier.nameSnapshot,
        priceDelta: modifier.priceDeltaSnapshot.toString(),
      })),
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

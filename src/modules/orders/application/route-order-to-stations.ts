import type { Prisma } from '@prisma/client';

export type RoutableOrderItem = {
  orderItemId: string;
  preparationStationId: string;
  quantity: number;
};
export async function routeOrderToStations(
  tx: Prisma.TransactionClient,
  order: { id: string; branchId: string },
  orderItems: RoutableOrderItem[],
): Promise<void> {
  const itemsByStation = new Map<string, RoutableOrderItem[]>();

  for (const item of orderItems) {
    const stationItems = itemsByStation.get(item.preparationStationId) ?? [];
    stationItems.push(item);
    itemsByStation.set(item.preparationStationId, stationItems);
  }

  const sentAt = new Date();

  for (const [preparationStationId, stationItems] of itemsByStation) {
    await tx.stationTicket.create({
      data: {
        orderId: order.id,
        branchId: order.branchId,
        preparationStationId,
        sentAt,
        stationTicketItems: {
          create: stationItems.map((item) => ({
            orderItemId: item.orderItemId,
            quantity: item.quantity,
          })),
        },
      },
    });
  }
}

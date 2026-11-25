import type { Prisma } from '@prisma/client';
import { enqueueStationTicketPrints } from '../../printing/application/enqueue-station-ticket-print';

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
  const ticketIds: Array<string | undefined> = [];

  for (const [preparationStationId, stationItems] of itemsByStation) {
    const ticket = await tx.stationTicket.create({
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

    ticketIds.push(ticket?.id);
  }

  await enqueueStationTicketPrints(tx, ticketIds);
}

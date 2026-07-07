import { OrderStatus, StationTicketStatus } from '@prisma/client';

/**
 * Deriva el estado comercial de la orden a partir del avance de sus tickets
 * de estacion. Los tickets cancelados no aportan al calculo.
 */
export function computeOrderStatusFromTickets(
  ticketStatuses: StationTicketStatus[],
): OrderStatus | null {
  const activeStatuses = ticketStatuses.filter(
    (status) => status !== StationTicketStatus.CANCELLED,
  );

  if (activeStatuses.length === 0) {
    return null;
  }

  if (activeStatuses.every((status) => status === StationTicketStatus.READY)) {
    return OrderStatus.READY;
  }

  if (activeStatuses.some((status) => status === StationTicketStatus.READY)) {
    return OrderStatus.PARTIALLY_READY;
  }

  if (
    activeStatuses.some((status) => status === StationTicketStatus.IN_PROGRESS)
  ) {
    return OrderStatus.IN_PREPARATION;
  }

  return OrderStatus.ROUTED;
}

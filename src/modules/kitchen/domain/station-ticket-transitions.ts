import { StationTicketStatus } from '@prisma/client';

/**
 * Transiciones validas del ciclo de vida de un ticket de estacion.
 * La cancelacion operativa queda restringida a supervisores en el caso de uso.
 */
export const STATION_TICKET_TRANSITIONS: Record<
  StationTicketStatus,
  StationTicketStatus[]
> = {
  [StationTicketStatus.PENDING]: [
    StationTicketStatus.ACCEPTED,
    StationTicketStatus.IN_PROGRESS,
    StationTicketStatus.CANCELLED,
  ],
  [StationTicketStatus.ACCEPTED]: [
    StationTicketStatus.IN_PROGRESS,
    StationTicketStatus.CANCELLED,
  ],
  [StationTicketStatus.IN_PROGRESS]: [
    StationTicketStatus.READY,
    StationTicketStatus.CANCELLED,
  ],
  [StationTicketStatus.READY]: [],
  [StationTicketStatus.CANCELLED]: [],
};

export function canTransitionStationTicket(
  from: StationTicketStatus,
  to: StationTicketStatus,
): boolean {
  return STATION_TICKET_TRANSITIONS[from].includes(to);
}

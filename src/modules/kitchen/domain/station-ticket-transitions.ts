import { StationTicketStatus } from '@prisma/client';
export const STATION_TICKET_TRANSITIONS: Record<
  StationTicketStatus,
  StationTicketStatus[]
> = {
  [StationTicketStatus.PENDING]: [
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

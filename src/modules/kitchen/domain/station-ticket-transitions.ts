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
    StationTicketStatus.PENDING,
    StationTicketStatus.CANCELLED,
  ],
  [StationTicketStatus.READY]: [StationTicketStatus.IN_PROGRESS],
  [StationTicketStatus.CANCELLED]: [],
};

export function canTransitionStationTicket(
  from: StationTicketStatus,
  to: StationTicketStatus,
): boolean {
  return STATION_TICKET_TRANSITIONS[from].includes(to);
}

export function isStationTicketReturn(
  from: StationTicketStatus,
  to: StationTicketStatus,
): boolean {
  return (
    (from === StationTicketStatus.IN_PROGRESS &&
      to === StationTicketStatus.PENDING) ||
    (from === StationTicketStatus.READY &&
      to === StationTicketStatus.IN_PROGRESS)
  );
}

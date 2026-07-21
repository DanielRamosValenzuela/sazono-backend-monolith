export const STATION_TICKET_READY_EVENT = 'station-ticket.ready';

export interface StationTicketReadyEvent {
  orderId: string;
  createdByStaffUserId: string | null;
}

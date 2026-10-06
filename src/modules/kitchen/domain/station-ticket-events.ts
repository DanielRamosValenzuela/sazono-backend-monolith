export const STATION_TICKET_READY_EVENT = 'station-ticket.ready';

export interface StationTicketReadyEvent {
  orderId: string;
  createdByStaffUserId: string | null;
  branchId?: string;
  label?: string;
  isCounter?: boolean;
  openedByStaffUserId?: string | null;
}

import { OrderStatus, StationTicketStatus } from '@prisma/client';
import { computeOrderStatusFromTickets } from './order-status-from-tickets';

describe('computeOrderStatusFromTickets', () => {
  it('returns null when there are no active tickets', () => {
    expect(computeOrderStatusFromTickets([])).toBeNull();
    expect(
      computeOrderStatusFromTickets([StationTicketStatus.CANCELLED]),
    ).toBeNull();
  });

  it('returns ROUTED when all active tickets are still pending or accepted', () => {
    expect(
      computeOrderStatusFromTickets([
        StationTicketStatus.PENDING,
        StationTicketStatus.ACCEPTED,
      ]),
    ).toBe(OrderStatus.ROUTED);
  });

  it('returns IN_PREPARATION when some ticket is in progress', () => {
    expect(
      computeOrderStatusFromTickets([
        StationTicketStatus.PENDING,
        StationTicketStatus.IN_PROGRESS,
      ]),
    ).toBe(OrderStatus.IN_PREPARATION);
  });

  it('returns PARTIALLY_READY when only part of the tickets are ready', () => {
    expect(
      computeOrderStatusFromTickets([
        StationTicketStatus.READY,
        StationTicketStatus.IN_PROGRESS,
      ]),
    ).toBe(OrderStatus.PARTIALLY_READY);
  });

  it('returns READY when every active ticket is ready', () => {
    expect(
      computeOrderStatusFromTickets([
        StationTicketStatus.READY,
        StationTicketStatus.CANCELLED,
        StationTicketStatus.READY,
      ]),
    ).toBe(OrderStatus.READY);
  });
});

import { StationTicketStatus } from '@prisma/client';
import {
  canTransitionStationTicket,
  isStationTicketReturn,
} from './station-ticket-transitions';

describe('station ticket transitions', () => {
  const { PENDING, IN_PROGRESS, READY, CANCELLED } = StationTicketStatus;

  it.each([
    [PENDING, IN_PROGRESS, true],
    [PENDING, CANCELLED, true],
    [PENDING, READY, false],
    [IN_PROGRESS, READY, true],
    [IN_PROGRESS, PENDING, true],
    [IN_PROGRESS, CANCELLED, true],
    [READY, IN_PROGRESS, true],
    [READY, PENDING, false],
    [READY, CANCELLED, false],
    [CANCELLED, PENDING, false],
  ])('%s -> %s allowed=%s', (from, to, allowed) => {
    expect(canTransitionStationTicket(from, to)).toBe(allowed);
  });

  it('flags only backwards moves as returns', () => {
    expect(isStationTicketReturn(IN_PROGRESS, PENDING)).toBe(true);
    expect(isStationTicketReturn(READY, IN_PROGRESS)).toBe(true);
    expect(isStationTicketReturn(PENDING, IN_PROGRESS)).toBe(false);
    expect(isStationTicketReturn(IN_PROGRESS, CANCELLED)).toBe(false);
  });
});

import { loadTicketPrintStates } from './ticket-print-status';

function build(jobs: unknown[], offline: unknown[] = []) {
  return {
    printJob: { findMany: jest.fn().mockResolvedValue(jobs) },
    printerStation: { findMany: jest.fn().mockResolvedValue(offline) },
  };
}

const tickets = [
  { id: 't1', preparationStationId: 's1' },
  { id: 't2', preparationStationId: 's1' },
  { id: 't3', preparationStationId: 's2' },
  { id: 't4', preparationStationId: 's2' },
];

describe('loadTicketPrintStates', () => {
  it('computes the state of every ticket with two batched queries', async () => {
    const prisma = build(
      [
        { id: 'j1', stationTicketId: 't1', status: 'PRINTED' },
        { id: 'j2', stationTicketId: 't2', status: 'FAILED' },
        { id: 'j3', stationTicketId: 't3', status: 'CLAIMED' },
      ],
      [{ preparationStationId: 's2' }],
    );

    const states = await loadTicketPrintStates(prisma as never, tickets);

    expect(states.get('t1')).toEqual({
      status: 'PRINTED',
      lastJobId: 'j1',
      printerOffline: false,
    });
    expect(states.get('t2')).toMatchObject({ status: 'FAILED' });
    expect(states.get('t3')).toEqual({
      status: 'PENDING',
      lastJobId: 'j3',
      printerOffline: true,
    });
    expect(states.get('t4')).toEqual({
      status: 'NONE',
      lastJobId: null,
      printerOffline: true,
    });
    expect(prisma.printJob.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.printerStation.findMany).toHaveBeenCalledTimes(1);

    const args = prisma.printJob.findMany.mock.calls[0][0];

    expect(args.where.stationTicketId.in).toEqual(['t1', 't2', 't3', 't4']);
    expect(args.where.kind).toBe('COMANDA');
    expect(args.orderBy[0]).toEqual({ createdAt: 'desc' });
    expect(args.distinct).toEqual(['stationTicketId', 'printerId']);
    expect(prisma.printerStation.findMany.mock.calls[0][0].where).toEqual({
      preparationStationId: { in: ['s1', 's2'] },
      printer: { active: true, status: 'OFFLINE' },
    });
  });

  it('aggregates the latest job per printer so a failure is not hidden', async () => {
    const prisma = build([
      { id: 'a', stationTicketId: 't1', printerId: 'p1', status: 'PRINTED' },
      { id: 'b', stationTicketId: 't1', printerId: 'p2', status: 'FAILED' },
      { id: 'c', stationTicketId: 't2', printerId: 'p1', status: 'PRINTED' },
      { id: 'd', stationTicketId: 't2', printerId: 'p2', status: 'CLAIMED' },
    ]);
    const states = await loadTicketPrintStates(prisma as never, tickets);

    expect(states.get('t1')).toMatchObject({
      status: 'FAILED',
      lastJobId: 'b',
    });
    expect(states.get('t2')).toMatchObject({
      status: 'PENDING',
      lastJobId: 'd',
    });
  });

  it('does not query when there are no tickets and falls back to empty on errors', async () => {
    const prisma = build([]);

    expect((await loadTicketPrintStates(prisma as never, [])).size).toBe(0);
    expect(prisma.printJob.findMany).not.toHaveBeenCalled();

    prisma.printJob.findMany.mockRejectedValue(new Error('db down'));
    expect((await loadTicketPrintStates(prisma as never, tickets)).size).toBe(
      0,
    );
  });
});

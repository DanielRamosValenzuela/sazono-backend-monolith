import type { Prisma } from '@prisma/client';
import { routeOrderToStations } from '../../orders/application/route-order-to-stations';
import {
  allocateTicketSeq,
  bindTicketCounterClient,
  enqueueStationTicketPrints,
} from './enqueue-station-ticket-print';
import { voidStationTicketPrint } from './void-station-ticket-print';

type Fake = Record<string, any>;

function ticketRow(overrides: Fake = {}): Fake {
  return {
    id: 'st-1',
    branchId: 'br-1',
    preparationStationId: 'ps-1',
    status: 'PENDING',
    displayNumber: null,
    sentAt: new Date('2026-11-25T17:32:00.000Z'),
    createdAt: new Date('2026-11-25T17:32:00.000Z'),
    preparationStation: {
      id: 'ps-1',
      branchId: 'br-1',
      name: 'pizza',
      printCode: '01',
    },
    branch: {
      restaurant: { timezone: 'America/Santiago' },
      settings: { businessDayStartHour: 4 },
    },
    order: {
      source: 'WAITER',
      notes: null,
      createdByStaffUser: { firstName: 'Juanita', lastName: 'Cajero' },
      tableSession: {
        isCounter: false,
        ticketNumber: null,
        customerLabel: null,
        table: { code: '7' },
      },
    },
    stationTicketItems: [
      {
        quantity: 1,
        orderItem: { nameSnapshot: 'Pizza', notes: null, modifiers: [] },
      },
    ],
    ...overrides,
  };
}

function makeTx(options: {
  ticket?: Fake | null;
  printers?: Fake[];
  failOn?: string;
}) {
  const counters = new Map<string, number>();
  const calls: string[] = [];
  const created: Fake[] = [];
  let lock: Promise<unknown> = Promise.resolve();

  const tx: Fake = {
    $executeRaw: jest.fn((strings: TemplateStringsArray) => {
      const sql = strings.join('');
      calls.push(sql.trim());

      if (options.failOn && sql.includes(options.failOn)) {
        return Promise.reject(new Error('sql boom'));
      }

      return Promise.resolve(1);
    }),
    $queryRaw: jest.fn(
      (_strings: TemplateStringsArray, stationId: string, date: string) => {
        const run = lock.then(async () => {
          await new Promise((resolve) =>
            setTimeout(resolve, Math.random() * 3),
          );
          const key = `${stationId}:${date}`;
          const next = (counters.get(key) ?? 0) + 1;
          counters.set(key, next);

          return [{ last_seq: next }];
        });
        lock = run.catch(() => undefined);

        return run;
      },
    ),
    stationTicket: {
      update: jest.fn().mockResolvedValue({}),
      findMany: jest.fn((args?: { where?: { id?: { in?: string[] } } }) =>
        Promise.resolve(
          args?.where?.id?.in
            ? options.ticket
              ? [options.ticket]
              : []
            : [{ id: 'st-1', branchId: 'br-1' }],
        ),
      ),
    },
    printerStation: {
      findMany: jest.fn().mockResolvedValue(options.printers ?? []),
    },
    preparationStation: {
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue({}),
    },
    printJob: {
      createMany: jest.fn((args: { data: Fake[] }) => {
        created.push(...args.data);

        return Promise.resolve({ count: args.data.length });
      }),
      findMany: jest.fn().mockResolvedValue([]),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    staffUser: { findUnique: jest.fn().mockResolvedValue(null) },
  };

  return {
    tx: tx as unknown as Prisma.TransactionClient,
    fake: tx,
    calls,
    created,
    counters,
  };
}

const printer = (id: string, copies = 1, stationId = 'ps-1'): Fake => ({
  preparationStationId: stationId,
  printer: { id, copies, active: true },
});

describe('daily numbering', () => {
  afterEach(() => bindTicketCounterClient(null));

  it('allocates on the bound autocommit client, never on the order transaction', async () => {
    const { tx, fake } = makeTx({});
    const root = makeTx({});

    bindTicketCounterClient(root.fake as never);

    expect(await allocateTicketSeq(tx, 'ps-1', '2026-11-25')).toBe(1);
    expect(await allocateTicketSeq(tx, 'ps-1', '2026-11-25')).toBe(2);
    expect(fake.$queryRaw).not.toHaveBeenCalled();
    expect(root.fake.$queryRaw).toHaveBeenCalledTimes(2);
  });

  it('keeps numbers unique and strictly increasing when the order transaction rolls back', async () => {
    const { tx } = makeTx({
      ticket: ticketRow(),
      printers: [printer('p-1')],
      failOn: 'never',
    });
    const root = makeTx({});

    bindTicketCounterClient(root.fake as never);
    (tx as never as Fake).printJob.createMany.mockRejectedValueOnce(
      new Error('constraint'),
    );
    await enqueueStationTicketPrints(tx, ['st-1']);
    await enqueueStationTicketPrints(tx, ['st-1']);

    const numbers = (tx as never as Fake).stationTicket.update.mock.calls.map(
      (c: Fake[]) => c[0].data.displayNumber,
    );

    expect(numbers).toEqual(['#01-001', '#01-002']);
  });

  it('allocates 1..20 without gaps or repeats under concurrency', async () => {
    const { tx } = makeTx({});
    const seqs = await Promise.all(
      Array.from({ length: 20 }, () =>
        allocateTicketSeq(tx, 'ps-1', '2026-11-25'),
      ),
    );

    expect([...seqs].sort((a, b) => a - b)).toEqual(
      Array.from({ length: 20 }, (_, i) => i + 1),
    );
  });

  it('keeps independent counters per station and per business day', async () => {
    const { tx } = makeTx({});

    expect(await allocateTicketSeq(tx, 'ps-1', '2026-11-25')).toBe(1);
    expect(await allocateTicketSeq(tx, 'ps-2', '2026-11-25')).toBe(1);
    expect(await allocateTicketSeq(tx, 'ps-1', '2026-11-26')).toBe(1);
    expect(await allocateTicketSeq(tx, 'ps-1', '2026-11-25')).toBe(2);
  });
});

describe('enqueueStationTicketPrint', () => {
  it('numbers the ticket and creates one job per printer with idempotency keys', async () => {
    const { tx, fake, created } = makeTx({
      ticket: ticketRow(),
      printers: [printer('p-1', 2), printer('p-2')],
    });

    await enqueueStationTicketPrints(tx, ['st-1']);

    expect(fake.stationTicket.findMany).toHaveBeenCalledTimes(1);
    expect(fake.printerStation.findMany).toHaveBeenCalledTimes(1);
    expect(fake.printJob.createMany).toHaveBeenCalledTimes(1);
    expect(fake.stationTicket.update).toHaveBeenCalledWith({
      where: { id: 'st-1' },
      data: {
        displayNumber: '#01-001',
        businessDate: new Date('2026-11-25T00:00:00.000Z'),
      },
    });
    expect(created.map((j) => j.idempotencyKey)).toEqual([
      'ST:st-1:P:p-1:R0',
      'ST:st-1:P:p-2:R0',
    ]);
    expect(created[0].document.copies).toBe(2);
    expect(created[0].document.header.number).toBe('#01-001');
    expect(fake.printJob.createMany.mock.calls[0][0].skipDuplicates).toBe(true);
  });

  it('assigns the next print code when the station has printers but no code', async () => {
    const { tx, fake } = makeTx({
      ticket: ticketRow({
        preparationStation: {
          id: 'ps-1',
          branchId: 'br-1',
          name: 'pizza',
          printCode: null,
        },
      }),
      printers: [printer('p-1')],
    });

    fake.preparationStation.findMany.mockResolvedValue([
      { printCode: '01' },
      { printCode: '07' },
    ]);
    await enqueueStationTicketPrints(tx, ['st-1']);

    expect(fake.preparationStation.update).toHaveBeenCalledWith({
      where: { id: 'ps-1' },
      data: { printCode: '08' },
    });
    expect(fake.stationTicket.update.mock.calls[0][0].data.displayNumber).toBe(
      '#08-001',
    );
  });

  it('serializes code assignment per branch and reuses a code assigned meanwhile', async () => {
    const { tx, fake, calls } = makeTx({
      ticket: ticketRow({
        preparationStation: {
          id: 'ps-1',
          branchId: 'br-1',
          name: 'pizza',
          printCode: null,
        },
      }),
      printers: [printer('p-1')],
    });

    fake.preparationStation.findMany.mockResolvedValue([
      { id: 'ps-1', printCode: '03' },
      { id: 'ps-2', printCode: '04' },
    ]);
    await enqueueStationTicketPrints(tx, ['st-1']);

    expect(calls.some((c) => c.includes('pg_advisory_xact_lock'))).toBe(true);
    expect(fake.preparationStation.update).not.toHaveBeenCalled();
    expect(fake.stationTicket.update.mock.calls[0][0].data.displayNumber).toBe(
      '#03-001',
    );
  });

  it('does nothing beyond the savepoint when there is no print code and no printers', async () => {
    const { tx, fake, created } = makeTx({
      ticket: ticketRow({
        preparationStation: {
          id: 'ps-1',
          branchId: 'br-1',
          name: 'pizza',
          printCode: null,
        },
      }),
      printers: [],
    });

    await enqueueStationTicketPrints(tx, ['st-1']);

    expect(fake.stationTicket.update).not.toHaveBeenCalled();
    expect(fake.$queryRaw).not.toHaveBeenCalled();
    expect(created).toHaveLength(0);
  });

  it('numbers the ticket even without printers when the station has a code', async () => {
    const { tx, fake, created } = makeTx({
      ticket: ticketRow(),
      printers: [],
    });

    await enqueueStationTicketPrints(tx, ['st-1']);

    expect(fake.stationTicket.update).toHaveBeenCalled();
    expect(created).toHaveLength(0);
  });

  it('does not renumber a ticket that already has a number', async () => {
    const { tx, fake, created } = makeTx({
      ticket: ticketRow({ displayNumber: '#01-005' }),
      printers: [printer('p-1')],
    });

    await enqueueStationTicketPrints(tx, ['st-1']);

    expect(fake.$queryRaw).not.toHaveBeenCalled();
    expect(created[0].document.header.number).toBe('#01-005');
  });

  it('swallows SQL errors and rolls back to the savepoint', async () => {
    const { tx, calls, fake } = makeTx({
      ticket: ticketRow(),
      printers: [printer('p-1')],
    });

    fake.printJob.createMany.mockRejectedValue(new Error('constraint'));

    await expect(
      enqueueStationTicketPrints(tx, ['st-1']),
    ).resolves.toBeUndefined();
    expect(calls).toEqual([
      'SAVEPOINT print_hook',
      'ROLLBACK TO SAVEPOINT print_hook',
      'RELEASE SAVEPOINT print_hook',
    ]);
  });

  it('swallows a failing savepoint and logic errors', async () => {
    const broken = makeTx({
      ticket: ticketRow({ order: null }),
      printers: [printer('p-1')],
    });
    const noSavepoint = makeTx({ ticket: ticketRow(), failOn: 'SAVEPOINT' });

    await expect(
      enqueueStationTicketPrints(broken.tx, ['st-1']),
    ).resolves.toBeUndefined();
    await expect(
      enqueueStationTicketPrints(noSavepoint.tx, ['st-1']),
    ).resolves.toBeUndefined();
    expect(noSavepoint.created).toHaveLength(0);
  });

  it('ignores a missing ticket id', async () => {
    const { tx, fake } = makeTx({});

    await enqueueStationTicketPrints(tx, [undefined]);

    expect(fake.$executeRaw).not.toHaveBeenCalled();
  });
});

describe('routeOrderToStations hook', () => {
  const items = [
    { orderItemId: 'oi-1', preparationStationId: 'ps-1', quantity: 1 },
    { orderItemId: 'oi-2', preparationStationId: 'ps-2', quantity: 2 },
  ];

  it('creates the tickets and still succeeds when the tx has no printing support', async () => {
    const create = jest
      .fn()
      .mockResolvedValueOnce({ id: 'st-1' })
      .mockResolvedValueOnce({ id: 'st-2' });
    const tx = {
      stationTicket: { create },
    } as unknown as Prisma.TransactionClient;

    await expect(
      routeOrderToStations(tx, { id: 'o-1', branchId: 'br-1' }, items),
    ).resolves.toBeUndefined();
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('works when create returns nothing (legacy mocks)', async () => {
    const create = jest.fn().mockResolvedValue(undefined);
    const tx = {
      stationTicket: { create },
    } as unknown as Prisma.TransactionClient;

    await expect(
      routeOrderToStations(tx, { id: 'o-1', branchId: 'br-1' }, items),
    ).resolves.toBeUndefined();
  });

  it('enqueues all tickets of the order with one batched lookup in the same transaction', async () => {
    const built = makeTx({
      printers: [printer('p-1'), printer('p-2', 1, 'ps-2')],
    });

    built.fake.stationTicket.create = jest
      .fn()
      .mockResolvedValueOnce({ id: 'st-1' })
      .mockResolvedValueOnce({ id: 'st-2' });
    built.fake.stationTicket.findMany.mockResolvedValue([
      ticketRow(),
      ticketRow({
        id: 'st-2',
        preparationStationId: 'ps-2',
        preparationStation: {
          id: 'ps-2',
          branchId: 'br-1',
          name: 'bar',
          printCode: '02',
        },
      }),
    ]);

    await routeOrderToStations(
      built.tx,
      { id: 'o-1', branchId: 'br-1' },
      items,
    );

    expect(built.fake.stationTicket.findMany).toHaveBeenCalledTimes(1);
    expect(built.fake.printerStation.findMany).toHaveBeenCalledTimes(1);
    expect(built.created.map((j) => j.idempotencyKey)).toEqual([
      'ST:st-1:P:p-1:R0',
      'ST:st-2:P:p-2:R0',
    ]);
    expect(built.created.map((j) => j.document.header.number)).toEqual([
      '#01-001',
      '#02-001',
    ]);
  });

  it('survives hook errors and rolls back only the savepoint', async () => {
    const built = makeTx({ ticket: ticketRow(), printers: [printer('p-1')] });

    built.fake.stationTicket.create = jest
      .fn()
      .mockResolvedValueOnce({ id: 'st-1' })
      .mockResolvedValueOnce({ id: 'st-2' });
    built.fake.stationTicket.findMany.mockRejectedValue(new Error('boom'));

    await expect(
      routeOrderToStations(built.tx, { id: 'o-1', branchId: 'br-1' }, items),
    ).resolves.toBeUndefined();
    expect(built.created).toHaveLength(0);
    expect(built.calls.filter((c) => c.startsWith('ROLLBACK'))).toHaveLength(1);
  });
});

describe('voidStationTicketPrint', () => {
  const docOf = () => ({
    v: 1,
    kind: 'COMANDA',
    copies: 1,
    header: { station: 'pizza', number: '#01-001' },
    meta: {
      printedAtLabel: '25/11/2026 14:32',
      createdAtIso: '2026-11-25T17:32:00.000Z',
      placeLabel: 'MESA 7',
      staffLabel: 'CAJERO, JUANITA',
      customerLabel: null,
      orderNotes: null,
    },
    banners: [],
    lines: [],
    footer: { qrPayload: null },
  });
  const job = (id: string, status: string, printVoidSlips = true): Fake => ({
    id,
    status,
    branchId: 'br-1',
    printerId: `p-${id}`,
    stationTicketId: 'st-1',
    document: docOf(),
    printer: { printVoidSlips, active: true },
    branch: { restaurant: { timezone: 'America/Santiago' } },
  });

  it('cancels pending and failed jobs and slips only printed or claimed ones', async () => {
    const { tx, fake, created } = makeTx({});

    fake.printJob.findMany.mockResolvedValue([
      job('a', 'PENDING'),
      job('b', 'FAILED'),
      job('c', 'PRINTED'),
      job('d', 'CLAIMED'),
      job('e', 'PRINTED', false),
    ]);
    fake.staffUser.findUnique.mockResolvedValue({
      firstName: 'Ana',
      lastName: 'Perez',
    });

    await voidStationTicketPrint(
      tx,
      { stationTicketId: 'st-1' },
      { reason: 'Error de mesero', actorStaffUserId: 'su-1' },
    );

    expect(fake.printJob.updateMany.mock.calls[0][0].where.id.in).toEqual([
      'a',
      'b',
    ]);
    expect(created.map((j) => j.idempotencyKey)).toEqual([
      'ST:st-1:P:p-c:VOID',
      'ST:st-1:P:p-d:VOID',
    ]);
    expect(created[0].kind).toBe('VOID');
    expect(created[0].document.banners).toContain('Motivo: Error de mesero');
    expect(created[0].document.banners).toContain('Anulado por: PEREZ, ANA');
  });

  it('does nothing and never throws when there are no jobs or the tx is incomplete', async () => {
    const empty = makeTx({});

    await voidStationTicketPrint(
      empty.tx,
      { orderId: 'o-1' },
      { reason: null, actorStaffUserId: null },
    );
    expect(empty.created).toHaveLength(0);

    const bare = {} as unknown as Prisma.TransactionClient;

    await expect(
      voidStationTicketPrint(
        bare,
        { orderId: 'o-1' },
        { reason: null, actorStaffUserId: null },
      ),
    ).resolves.toBeUndefined();
  });
});

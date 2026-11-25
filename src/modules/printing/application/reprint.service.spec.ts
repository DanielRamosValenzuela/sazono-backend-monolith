import { ConflictException } from '@nestjs/common';
import type { AuditService } from '../../../common/audit/audit.service';
import { ReprintService } from './reprint.service';

const actor = {
  restaurantId: 'rest-1',
  branchId: 'br-1',
  staffUserId: null,
  role: null,
};

const original = {
  id: 'job-0',
  branchId: 'br-1',
  printerId: 'pr-1',
  stationTicketId: 'st-1',
  kind: 'COMANDA',
  document: {
    v: 1,
    kind: 'COMANDA',
    copies: 1,
    header: { station: 'pizza', number: '#01-001' },
    meta: {
      printedAtLabel: '25/11/2026 14:32',
      createdAtIso: '2026-11-25T14:32:00.000Z',
      placeLabel: 'MESA 7',
      staffLabel: '',
      customerLabel: null,
      orderNotes: null,
    },
    banners: [],
    lines: [{ qty: 1, name: 'Pizza', options: [], note: null }],
    footer: { qrPayload: null },
  },
  branch: { restaurant: { timezone: 'America/Santiago' } },
};

function setup() {
  const keys = ['ST:st-1:P:pr-1:R0'];
  const events: string[] = [];
  let gate: Promise<unknown> = Promise.resolve();
  const tx = {
    $queryRaw: jest.fn(async () => {
      const turn = gate;
      let release!: () => void;

      gate = new Promise<void>((resolve) => (release = resolve));
      await turn;
      events.push('lock');
      tx.release.push(release);

      return [];
    }),
    release: [] as Array<() => void>,
    printJob: {
      findMany: jest.fn(() =>
        Promise.resolve(keys.map((idempotencyKey) => ({ idempotencyKey }))),
      ),
      create: jest.fn(({ data }: { data: { idempotencyKey: string } }) => {
        keys.push(data.idempotencyKey);
        events.push(`create ${data.idempotencyKey}`);
        tx.release.shift()?.();

        return Promise.resolve({ id: `job-${keys.length}`, ...data });
      }),
    },
  };
  const prisma = {
    printJob: { findFirst: jest.fn().mockResolvedValue(original) },
    staffUser: { findUnique: jest.fn() },
    $transaction: jest.fn((fn: (t: unknown) => Promise<unknown>) => fn(tx)),
  };
  const audit = { record: jest.fn() };
  const service = new ReprintService(
    prisma as never,
    audit as unknown as AuditService,
  );

  return { service, tx, events, prisma };
}

describe('ReprintService', () => {
  it('answers 409 with a clear message when reprinting a void slip', async () => {
    const { service, prisma } = setup();

    prisma.printJob.findFirst.mockResolvedValue({ ...original, kind: 'VOID' });

    const error = await service.reprintJob('job-0', actor).catch((e) => e);

    expect(error).toBeInstanceOf(ConflictException);
    expect(error.message).toBe('Las hojas de anulacion no se reimprimen.');
  });

  it('answers 409 when reprinting a test job without a ticket', async () => {
    const { service, prisma } = setup();

    prisma.printJob.findFirst.mockResolvedValue({
      ...original,
      kind: 'TEST',
      stationTicketId: null,
    });

    const error = await service.reprintJob('job-0', actor).catch((e) => e);

    expect(error).toBeInstanceOf(ConflictException);
    expect(error.message).toBe('Solo se reimprimen comandas.');
  });

  it('locks the ticket row before computing the next reprint number', async () => {
    const { service, events } = setup();

    await service.reprintJob('job-0', actor);

    expect(events).toEqual(['lock', 'create ST:st-1:P:pr-1:R1']);
  });

  it('gives concurrent double taps consecutive numbers instead of a duplicate key', async () => {
    const { service, events } = setup();

    await Promise.all([
      service.reprintJob('job-0', actor),
      service.reprintJob('job-0', actor),
    ]);

    expect(events).toEqual([
      'lock',
      'create ST:st-1:P:pr-1:R1',
      'lock',
      'create ST:st-1:P:pr-1:R2',
    ]);
  });
});

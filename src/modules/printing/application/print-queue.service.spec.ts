import { createServer, type Server } from 'node:net';
import { PrinterTransport, PrintJobStatus, type Printer } from '@prisma/client';
import { Tcp9100Transport } from '../infrastructure/tcp9100.transport';
import { PrintQueueService } from './print-queue.service';
import { PrintReconcilerService } from './print-reconciler.service';
import { PrintWorkerService } from './print-worker.service';
import type { PrintAlertsService } from './print-alerts.service';
import type { PrintingConfigService } from './printing-config.service';

type Fake = Record<string, any>;

const config = {
  maxAttempts: 6,
  retryBaseMs: 5000,
  batchSize: 20,
  serverLeaseSeconds: 30,
  deviceLeaseSeconds: 45,
  lateMinutes: 10,
  tcpEnabled: false,
  tcpAllowLocal: true,
  tcpConnectTimeoutMs: 500,
  tcpWriteTimeoutMs: 500,
  stuckClaimMinutes: 5,
  deviceOfflineSeconds: 90,
  doneRetentionDays: 30,
  failedRetentionDays: 90,
} as unknown as PrintingConfigService;

const doc = {
  v: 1,
  kind: 'COMANDA',
  copies: 1,
  header: { station: 'pizza', number: '#01-001' },
  meta: {
    printedAtLabel: '25/11/2026 14:32',
    createdAtIso: new Date().toISOString(),
    placeLabel: 'MESA 1',
    staffLabel: '',
    customerLabel: null,
    orderNotes: null,
  },
  banners: [],
  lines: [{ qty: 1, name: 'Pizza', options: [], note: null }],
  footer: { qrPayload: null },
};

function setup() {
  const prisma: Fake = {
    $queryRaw: jest.fn(),
    printJob: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    printer: {
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      findMany: jest.fn().mockResolvedValue([]),
    },
    stationTicket: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const audit = { record: jest.fn() };
  const alerts = {
    jobFailed: jest.fn().mockResolvedValue(undefined),
    printerOffline: jest.fn().mockResolvedValue(true),
  };
  const queue = new PrintQueueService(
    prisma as never,
    config,
    audit as never,
    alerts as unknown as PrintAlertsService,
  );

  return { prisma, audit, alerts, queue };
}

describe('PrintQueueService', () => {
  describe('claim', () => {
    it('returns nothing when no row is due', async () => {
      const { prisma, queue } = setup();

      prisma.$queryRaw.mockResolvedValue([]);

      await expect(
        queue.claim({
          transports: [PrinterTransport.SIMULATED],
          limit: 5,
          leaseSeconds: 30,
          claimedBy: 'server',
        }),
      ).resolves.toEqual([]);
      expect(prisma.printJob.findMany).not.toHaveBeenCalled();
    });

    it('uses SKIP LOCKED, scopes by device and drops jobs whose ticket is no longer pending', async () => {
      const { prisma, queue } = setup();

      prisma.$queryRaw.mockResolvedValue([
        { id: 'j1', was_claimed: false },
        { id: 'j2', was_claimed: true },
        { id: 'j3', was_claimed: false },
      ]);
      const printer = { id: 'p1' };

      prisma.printJob.findMany.mockResolvedValue([
        {
          id: 'j1',
          kind: 'COMANDA',
          reprintOfId: null,
          idempotencyKey: 'ST:t:P:p:R0',
          lastError: null,
          printer,
          stationTicket: { status: 'PENDING' },
        },
        {
          id: 'j2',
          kind: 'COMANDA',
          reprintOfId: null,
          idempotencyKey: 'ST:t:P:p:R0',
          lastError: null,
          printer,
          stationTicket: { status: 'IN_PROGRESS' },
        },
        {
          id: 'j3',
          kind: 'COMANDA',
          reprintOfId: null,
          idempotencyKey: 'ST:t:P:p:R0',
          lastError: null,
          printer,
          stationTicket: { status: 'READY' },
        },
      ]);

      const claimed = await queue.claim({
        deviceId: 'dev-1',
        branchId: 'br-1',
        limit: 5,
        leaseSeconds: 45,
        claimedBy: null,
      });
      const sql = (prisma.$queryRaw.mock.calls[0][0] as { sql: string }).sql;

      expect(sql).toContain('FOR UPDATE OF j SKIP LOCKED');
      expect(sql).toContain('print_device_printers');
      expect(sql).toContain('attempts = t.attempts + 1');
      expect(claimed.map((c) => [c.job.id, c.retryUncertain])).toEqual([
        ['j1', false],
        ['j2', true],
      ]);
      expect(prisma.printJob.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['j3'] } },
        data: expect.objectContaining({
          status: PrintJobStatus.CANCELLED,
          lastError: 'TICKET_NOT_PENDING',
        }),
      });
    });

    it('prints explicit reprints and manual retries even if the ticket is ready', async () => {
      const { prisma, queue } = setup();
      const printer = { id: 'p1' };
      const base = {
        kind: 'COMANDA',
        printer,
        stationTicket: { status: 'READY' },
      };

      prisma.$queryRaw.mockResolvedValue([
        { id: 'r1', was_claimed: false },
        { id: 'm1', was_claimed: false },
        { id: 'o1', was_claimed: false },
      ]);
      prisma.printJob.findMany.mockResolvedValue([
        {
          ...base,
          id: 'r1',
          reprintOfId: 'o1',
          idempotencyKey: 'ST:t:P:p:R1',
          lastError: null,
        },
        {
          ...base,
          id: 'm1',
          reprintOfId: null,
          idempotencyKey: 'ST:t:P:p:R0',
          lastError: 'MANUAL_RETRY [TCP_TIMEOUT] x',
        },
        {
          ...base,
          id: 'o1',
          reprintOfId: null,
          idempotencyKey: 'ST:t:P:p:R0',
          lastError: null,
        },
      ]);

      const claimed = await queue.claim({
        limit: 5,
        leaseSeconds: 30,
        claimedBy: 'server',
      });

      expect(claimed.map((c) => c.job.id)).toEqual(['r1', 'm1']);
      expect(prisma.printJob.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['o1'] } },
        data: expect.objectContaining({ lastError: 'TICKET_NOT_PENDING' }),
      });
    });

    it('never drops void slips for a cancelled ticket', async () => {
      const { prisma, queue } = setup();

      prisma.$queryRaw.mockResolvedValue([{ id: 'v1', was_claimed: false }]);
      prisma.printJob.findMany.mockResolvedValue([
        {
          id: 'v1',
          kind: 'VOID',
          printer: {},
          stationTicket: { status: 'CANCELLED' },
        },
      ]);

      const claimed = await queue.claim({
        limit: 5,
        leaseSeconds: 30,
        claimedBy: 'server',
      });

      expect(claimed).toHaveLength(1);
    });
  });

  describe('ack', () => {
    it('marks printed, counts duplicates and ignores cancelled jobs', async () => {
      const { prisma, queue } = setup();

      await expect(queue.ack('j1')).resolves.toBe('PRINTED');

      prisma.printJob.updateMany.mockResolvedValue({ count: 0 });
      prisma.printJob.findFirst.mockResolvedValueOnce({ status: 'PRINTED' });
      await expect(queue.ack('j1')).resolves.toBe('DUPLICATE');
      expect(prisma.printJob.update).toHaveBeenCalledWith({
        where: { id: 'j1' },
        data: { duplicateAcks: { increment: 1 } },
      });

      prisma.printJob.findFirst.mockResolvedValueOnce({ status: 'CANCELLED' });
      await expect(queue.ack('j1')).resolves.toBe('IGNORED');

      prisma.printJob.findFirst.mockResolvedValueOnce(null);
      await expect(queue.ack('j1', { branchId: 'other' })).resolves.toBe(
        'NOT_FOUND',
      );
    });

    it('accepts a late ack for a job whose lease expired and returned to pending', async () => {
      const { prisma, queue } = setup();

      await queue.ack('j1');

      expect(
        prisma.printJob.updateMany.mock.calls[0][0].where.status.in,
      ).toEqual(['CLAIMED', 'PENDING', 'FAILED']);
    });
  });

  describe('fail', () => {
    const claimedJob = (attempts: number) => ({
      id: 'j1',
      branchId: 'br-1',
      attempts,
      document: doc,
      printer: { name: 'Cocina' },
      branch: { restaurantId: 'r-1' },
    });

    it('goes back to pending with backoff while attempts remain', async () => {
      const { prisma, queue, alerts } = setup();

      prisma.printJob.findFirst.mockResolvedValue(claimedJob(2));

      await expect(
        queue.fail('j1', { code: 'X', message: 'm', retryable: true }),
      ).resolves.toBe('PENDING');
      expect(prisma.printJob.updateMany.mock.calls[0][0].data.status).toBe(
        'PENDING',
      );
      expect(
        prisma.printJob.updateMany.mock.calls[0][0].data.nextAttemptAt,
      ).toBeInstanceOf(Date);
      expect(alerts.jobFailed).not.toHaveBeenCalled();
    });

    it('fails permanently and alerts after the last attempt', async () => {
      const { prisma, queue, alerts } = setup();

      prisma.printJob.findFirst.mockResolvedValue(claimedJob(6));

      await expect(
        queue.fail('j1', { code: 'TCP', message: 'down', retryable: true }),
      ).resolves.toBe('FAILED');
      expect(alerts.jobFailed).toHaveBeenCalledWith(
        expect.objectContaining({ entityId: 'j1', restaurantId: 'r-1' }),
        expect.objectContaining({ displayNumber: '#01-001' }),
      );
    });

    it('fails immediately when not retryable and ignores unclaimed jobs', async () => {
      const { prisma, queue } = setup();

      prisma.printJob.findFirst.mockResolvedValue(claimedJob(1));
      await expect(
        queue.fail('j1', { code: 'X', message: 'm', retryable: false }),
      ).resolves.toBe('FAILED');

      prisma.printJob.findFirst.mockResolvedValue(null);
      await expect(
        queue.fail('j1', { code: 'X', message: 'm', retryable: true }),
      ).resolves.toBe('IGNORED');
    });
  });

  it('retries a failed job manually only inside the branch and audits it', async () => {
    const { prisma, queue, audit } = setup();
    const actor = { restaurantId: 'r', branchId: 'br', staffUserId: 'u' };

    await expect(queue.manualRetry('j1', actor)).resolves.toBe(true);
    expect(prisma.printJob.updateMany.mock.calls[0][0].where).toEqual({
      id: 'j1',
      branchId: 'br',
      status: 'FAILED',
    });
    expect(audit.record).toHaveBeenCalled();

    prisma.printJob.updateMany.mockResolvedValue({ count: 0 });
    await expect(queue.manualRetry('j1', actor)).resolves.toBe(false);
  });
});

describe('PrintWorkerService', () => {
  const printerOf = (transport: PrinterTransport): Printer =>
    ({
      id: 'p1',
      name: 'Cocina',
      transport,
      columns: 32,
      codepage: 'cp858',
      escTCodepageId: null,
      autoCut: true,
      cashDrawer: false,
      copies: 1,
      connection: { host: '127.0.0.1', port: 9108 },
    }) as unknown as Printer;

  function build(items: unknown[], overrides: Fake = {}) {
    const prisma: Fake = { printer: { update: jest.fn() } };
    const queue = {
      claim: jest.fn().mockResolvedValue(items),
      ack: jest.fn(),
      fail: jest.fn(),
      extend: jest.fn().mockResolvedValue(true),
    };
    const simulated = {
      kind: PrinterTransport.SIMULATED,
      deliver: jest.fn().mockResolvedValue({ kind: 'OK' }),
    };
    const tcp = {
      kind: PrinterTransport.TCP,
      deliver: jest.fn().mockResolvedValue({
        kind: 'FAILED',
        retryable: true,
        code: 'ECONNREFUSED',
        message: 'refused',
      }),
    };
    const worker = new PrintWorkerService(
      prisma as never,
      queue as never,
      { ...config, ...overrides } as PrintingConfigService,
      simulated,
      tcp as unknown as Tcp9100Transport,
    );

    return { worker, queue, prisma, simulated, tcp };
  }

  const item = (transport: PrinterTransport) => ({
    job: { id: 'j1', attempts: 1, document: doc },
    printer: printerOf(transport),
    retryUncertain: false,
  });

  it('prints simulated jobs automatically and marks the printer online', async () => {
    const { worker, queue, prisma } = build([item(PrinterTransport.SIMULATED)]);

    await expect(worker.runOnce()).resolves.toEqual({
      claimed: 1,
      printed: 1,
      failed: 0,
    });
    expect(queue.ack).toHaveBeenCalledWith('j1');
    expect(prisma.printer.update.mock.calls[0][0].data.status).toBe('ONLINE');
  });

  it('only claims SIMULATED unless TCP is enabled', async () => {
    const off = build([]);
    const on = build([], { tcpEnabled: true });

    await off.worker.runOnce();
    await on.worker.runOnce();

    expect(off.queue.claim.mock.calls[0][0].transports).toEqual(['SIMULATED']);
    expect(on.queue.claim.mock.calls[0][0].transports).toEqual([
      'SIMULATED',
      'TCP',
    ]);
  });

  it('reports a TCP failure to the queue and marks the printer offline', async () => {
    const { worker, queue, prisma, tcp } = build([item(PrinterTransport.TCP)]);

    await expect(worker.runOnce()).resolves.toEqual({
      claimed: 1,
      printed: 0,
      failed: 1,
    });
    expect(tcp.deliver.mock.calls[0][1]).toBeInstanceOf(Uint8Array);
    expect(queue.fail).toHaveBeenCalledWith(
      'j1',
      expect.objectContaining({ code: 'ECONNREFUSED', retryable: true }),
    );
    expect(prisma.printer.update.mock.calls[0][0].data.status).toBe('OFFLINE');
  });

  it('does not let a dead printer block jobs for other printers and renews the lease before each send', async () => {
    const dead = (id: string) => ({
      job: { id, attempts: 1, document: doc },
      printer: { ...printerOf(PrinterTransport.TCP), id: 'dead' },
      retryUncertain: false,
    });
    const ok = (id: string) => ({
      job: { id, attempts: 1, document: doc },
      printer: { ...printerOf(PrinterTransport.SIMULATED), id: 'ok' },
      retryUncertain: false,
    });
    const { worker, queue, tcp, simulated } = build([
      dead('d1'),
      dead('d2'),
      ok('o1'),
      ok('o2'),
    ]);
    const order: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));

    tcp.deliver.mockImplementation(async () => {
      order.push('dead-start');
      await gate;
      order.push('dead-end');

      return {
        kind: 'FAILED',
        retryable: true,
        code: 'ETIMEDOUT',
        message: 't',
      };
    });
    simulated.deliver.mockImplementation(() => {
      order.push('ok');

      return Promise.resolve({ kind: 'OK' });
    });

    const run = worker.runOnce();

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(order).toEqual(['dead-start', 'ok', 'ok']);
    release();

    await expect(run).resolves.toEqual({ claimed: 4, printed: 2, failed: 2 });
    expect(order.slice(3)).toEqual(['dead-end', 'dead-start', 'dead-end']);
    expect(queue.extend).toHaveBeenCalledTimes(4);
    expect(queue.extend).toHaveBeenCalledWith('d1', undefined, 30);
  });

  it('skips a job whose lease could not be renewed', async () => {
    const { worker, queue, simulated } = build([
      item(PrinterTransport.SIMULATED),
    ]);

    queue.extend.mockResolvedValue(false);

    await expect(worker.runOnce()).resolves.toEqual({
      claimed: 1,
      printed: 0,
      failed: 1,
    });
    expect(simulated.deliver).not.toHaveBeenCalled();
  });

  it('fails non-retryably when the stored document is invalid and survives unexpected errors', async () => {
    const bad = build([
      {
        ...item(PrinterTransport.SIMULATED),
        job: { id: 'j1', attempts: 1, document: {} },
      },
    ]);

    await bad.worker.runOnce();
    expect(bad.queue.fail).toHaveBeenCalledWith(
      'j1',
      expect.objectContaining({ code: 'INVALID_DOCUMENT', retryable: false }),
    );

    const boom = build([item(PrinterTransport.SIMULATED)]);

    boom.simulated.deliver.mockRejectedValue(new Error('crash'));
    await expect(boom.worker.runOnce()).resolves.toEqual({
      claimed: 1,
      printed: 0,
      failed: 1,
    });
    expect(boom.queue.fail).toHaveBeenCalledWith(
      'j1',
      expect.objectContaining({ code: 'INTERNAL_ERROR' }),
    );
  });
});

describe('Tcp9100Transport', () => {
  const transport = new Tcp9100Transport(config);
  const printerAt = (connection: unknown): Printer =>
    ({ connection }) as unknown as Printer;
  const signal = new AbortController().signal;
  let server: Server | null = null;

  afterEach(() => {
    server?.close();
    server = null;
  });

  it('rejects forbidden ports, hosts and malformed connections without retry', async () => {
    const port = await transport.deliver(
      printerAt({ host: '192.168.1.5', port: 22 }),
      new Uint8Array(),
      signal,
    );
    const host = await transport.deliver(
      printerAt({ host: '8.8.8.8', port: 9100 }),
      new Uint8Array(),
      signal,
    );
    const meta = await transport.deliver(
      printerAt({ host: '169.254.169.254', port: 9100 }),
      new Uint8Array(),
      signal,
    );
    const bad = await transport.deliver(
      printerAt({}),
      new Uint8Array(),
      signal,
    );

    expect(port).toMatchObject({
      code: 'TCP_PORT_FORBIDDEN',
      retryable: false,
    });
    expect(host).toMatchObject({
      code: 'TCP_HOST_FORBIDDEN',
      retryable: false,
    });
    expect(meta).toMatchObject({ code: 'TCP_HOST_FORBIDDEN' });
    expect(bad).toMatchObject({ code: 'TCP_BAD_CONNECTION' });
  });

  it('rejects unspecified, broadcast and multicast targets even when local is allowed', async () => {
    for (const host of [
      '0.0.0.0',
      '255.255.255.255',
      '224.0.0.251',
      '2130706433',
    ]) {
      await expect(
        transport.deliver(
          printerAt({ host, port: 9100 }),
          new Uint8Array(),
          signal,
        ),
      ).resolves.toMatchObject({
        code: 'TCP_HOST_FORBIDDEN',
        retryable: false,
      });
    }
  });

  it('blocks loopback when local targets are not allowed', async () => {
    const strict = new Tcp9100Transport({
      ...config,
      tcpAllowLocal: false,
    } as PrintingConfigService);

    await expect(
      strict.deliver(
        printerAt({ host: '127.0.0.1', port: 9100 }),
        new Uint8Array(),
        signal,
      ),
    ).resolves.toMatchObject({ code: 'TCP_HOST_FORBIDDEN' });
  });

  it('writes the bytes to the printer socket and reports connection errors as retryable', async () => {
    const received: Buffer[] = [];

    server = createServer((socket) => {
      socket.on('data', (chunk) => received.push(chunk));
    });
    await new Promise<void>((resolve) =>
      server!.listen(9108, '127.0.0.1', resolve),
    );

    const ok = await transport.deliver(
      printerAt({ host: '127.0.0.1', port: 9108 }),
      Uint8Array.from([0x1b, 0x40, 0x41]),
      signal,
    );

    expect(ok).toEqual({ kind: 'OK' });
    expect(Buffer.concat(received).toString('hex')).toBe('1b4041');

    await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = null;

    const refused = await transport.deliver(
      printerAt({ host: '127.0.0.1', port: 9108 }),
      Uint8Array.from([1]),
      signal,
    );

    expect(refused).toMatchObject({ kind: 'FAILED', retryable: true });
  });
});

describe('PrintReconcilerService', () => {
  it('creates missing jobs, releases stuck claims, marks silent devices offline and purges', async () => {
    const { prisma, alerts } = setup();
    const tx = {};

    prisma.$transaction = jest.fn((fn: (t: unknown) => Promise<unknown>) =>
      fn(tx),
    );
    prisma.printJob.findMany.mockResolvedValue([
      {
        id: 'stuck-1',
        branchId: 'br',
        document: { header: { number: '#01-007' } },
        printer: { name: 'Cocina' },
        branch: { restaurantId: 'r' },
      },
    ]);
    prisma.printJob.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 2 });
    prisma.printer.updateMany.mockResolvedValue({ count: 3 });
    prisma.printer.findMany.mockResolvedValue([
      {
        id: 'p1',
        branchId: 'br',
        name: 'Cocina',
        lastError: null,
        branch: { restaurantId: 'r' },
      },
    ]);
    prisma.printJob.deleteMany.mockResolvedValue({ count: 4 });

    const reconciler = new PrintReconcilerService(
      prisma as never,
      config,
      alerts as unknown as PrintAlertsService,
    );
    const result = await reconciler.runOnce(new Date('2026-11-25T12:00:00Z'));

    expect(result).toEqual({
      created: 0,
      released: 2,
      failedStuck: 1,
      markedOffline: 3,
      alerted: 1,
      purged: 8,
    });
    expect(alerts.printerOffline).toHaveBeenCalledTimes(1);
    expect(alerts.jobFailed).toHaveBeenCalledWith(
      expect.objectContaining({ entityId: 'stuck-1', branchId: 'br' }),
      {
        printerName: 'Cocina',
        code: 'LEASE_EXPIRED',
        displayNumber: '#01-007',
      },
    );
  });

  it('does not alert when another worker already resolved the stuck claim', async () => {
    const { prisma, alerts } = setup();

    prisma.printJob.findMany.mockResolvedValue([
      {
        id: 'stuck-1',
        branchId: 'br',
        document: {},
        printer: { name: 'Cocina' },
        branch: { restaurantId: 'r' },
      },
    ]);
    prisma.printJob.updateMany.mockResolvedValue({ count: 0 });

    const reconciler = new PrintReconcilerService(
      prisma as never,
      config,
      alerts as unknown as PrintAlertsService,
    );
    const result = await reconciler.releaseStuckClaims(new Date());

    expect(result.failedStuck).toBe(0);
    expect(alerts.jobFailed).not.toHaveBeenCalled();
  });

  it('only completes tickets created after the printer was linked', async () => {
    const { prisma, alerts } = setup();
    const tx = {};
    const linked = new Date('2026-11-25T10:00:00Z');
    const link = { createdAt: linked, printer: { createdAt: linked } };

    prisma.$transaction = jest.fn((fn: (t: unknown) => Promise<unknown>) =>
      fn(tx),
    );
    prisma.stationTicket.findMany.mockResolvedValue([
      {
        id: 'before',
        createdAt: new Date('2026-11-25T09:00:00Z'),
        preparationStation: { printers: [link] },
      },
      {
        id: 'after',
        createdAt: new Date('2026-11-25T11:00:00Z'),
        preparationStation: { printers: [link] },
      },
    ]);

    const reconciler = new PrintReconcilerService(
      prisma as never,
      config,
      alerts as unknown as PrintAlertsService,
    );

    await reconciler.createMissingJobs(new Date('2026-11-25T12:00:00Z'));

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });
});

import {
  BadRequestException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { PrintDeviceKind, PrinterTransport } from '@prisma/client';
import { hashPairingCode, hashSecret } from '../domain/device-security';
import {
  DeviceProtocolService,
  PairingThrottledException,
  type DeviceContext,
} from './device-protocol.service';
import type { PrintQueueService } from './print-queue.service';
import type { PrintWakeService } from './print-wake.service';
import type { PrintingConfigService } from './printing-config.service';

type Mocks = Record<string, jest.Mock>;
type FakeDb = Record<string, Mocks> & { $transaction: jest.Mock };

const config = {
  deviceLeaseSeconds: 45,
  lateMinutes: 10,
  longPollMaxSeconds: 25,
  tcpAllowLocal: false,
  pairingSecret: 'test-pairing-secret-0123456789abcdef',
} as unknown as PrintingConfigService;

const ctx: DeviceContext = {
  deviceId: 'dev-1',
  branchId: 'br-1',
  restaurantId: 'rest-1',
  kind: PrintDeviceKind.BROWSER,
};

const doc = {
  v: 1,
  kind: 'COMANDA',
  copies: 1,
  header: { station: 'pizza', number: '#01-023' },
  meta: {
    printedAtLabel: '25/11/2026 14:32',
    createdAtIso: new Date().toISOString(),
    placeLabel: 'MESA 7',
    staffLabel: 'CAJERO, JUANITA',
    customerLabel: null,
    orderNotes: null,
  },
  banners: [],
  lines: [{ qty: 1, name: 'Pizza 3 quesos', options: [], note: null }],
  footer: { qrPayload: null },
};

const printer = {
  id: 'pr-1',
  name: 'Cocina',
  transport: PrinterTransport.BROWSER,
  connection: {},
  paperWidthMm: 58,
  columns: 32,
  codepage: 'cp858',
  escTCodepageId: null,
  copies: 1,
  autoCut: true,
  cashDrawer: false,
  status: 'ONLINE',
};

function claimed(id: string, retryUncertain = false) {
  return {
    job: {
      id,
      kind: 'COMANDA',
      document: doc,
      attempts: 1,
      leaseUntil: new Date('2026-11-25T15:00:00Z'),
    },
    printer,
    retryUncertain,
  };
}

function setup() {
  const prisma = {
    printDevice: {
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    printDevicePrinter: {
      findMany: jest.fn().mockResolvedValue([]),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      createMany: jest.fn(),
    },
    printer: {
      findMany: jest.fn().mockResolvedValue([]),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      count: jest.fn(),
    },
    printJob: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    $transaction: jest.fn(),
  } as unknown as FakeDb;
  prisma.$transaction.mockImplementation((fn: (t: unknown) => unknown) =>
    fn(prisma),
  );
  const queue = {
    claim: jest.fn().mockResolvedValue([]),
    ack: jest.fn(),
    fail: jest.fn(),
    extend: jest.fn(),
    release: jest.fn().mockResolvedValue(0),
  };
  const audit = { record: jest.fn() };
  const wake = { waitFor: jest.fn().mockResolvedValue(undefined) };
  const service = new DeviceProtocolService(
    prisma as never,
    queue as unknown as PrintQueueService,
    audit as never,
    config,
    wake as unknown as PrintWakeService,
  );

  return { prisma, queue, audit, wake, service };
}

describe('DeviceProtocolService', () => {
  describe('authenticate', () => {
    it('rejects missing or malformed headers without touching the database', async () => {
      const { prisma, service } = setup();

      await expect(service.authenticate(undefined)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      await expect(service.authenticate('Bearer abc')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      await expect(service.authenticate('Device short')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      expect(prisma.printDevice.findUnique).not.toHaveBeenCalled();
    });

    it('looks the token up by its hash, never by the raw value', async () => {
      const { prisma, service } = setup();
      const token = 'a'.repeat(43);

      prisma.printDevice.findUnique.mockResolvedValue({
        id: 'dev-1',
        branchId: 'br-1',
        kind: PrintDeviceKind.BROWSER,
        active: true,
        branch: { restaurantId: 'rest-1' },
      });

      await expect(service.authenticate(`Device ${token}`)).resolves.toEqual(
        ctx,
      );
      expect(prisma.printDevice.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tokenHash: hashSecret(token) },
        }),
      );
      expect(
        JSON.stringify(prisma.printDevice.findUnique.mock.calls),
      ).not.toContain(token);
    });

    it('rejects unknown, revoked and deactivated tokens', async () => {
      const { prisma, service } = setup();
      const header = `Device ${'b'.repeat(43)}`;

      prisma.printDevice.findUnique.mockResolvedValueOnce(null);
      await expect(service.authenticate(header)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );

      prisma.printDevice.findUnique.mockResolvedValueOnce({
        id: 'dev-1',
        branchId: 'br-1',
        kind: PrintDeviceKind.BROWSER,
        active: false,
        branch: { restaurantId: 'rest-1' },
      });
      await expect(service.authenticate(header)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });
  });

  describe('pair', () => {
    const dto = {
      code: '123456',
      name: 'Tablet cocina',
      kind: PrintDeviceKind.ANDROID_APP,
      appVersion: '1.0.0',
    };

    it('exchanges a valid code for a token stored only as a hash and is single use', async () => {
      const { prisma, audit, service } = setup();

      prisma.printDevice.findFirst.mockResolvedValue({
        id: 'dev-1',
        branchId: 'br-1',
        branch: { restaurantId: 'rest-1' },
      });

      const result = await service.pair(dto, { ip: '1.2.3.4' });
      const update = prisma.printDevice.updateMany.mock.calls[0][0] as {
        where: Record<string, unknown>;
        data: Record<string, unknown>;
      };

      expect(result.token).toHaveLength(43);
      expect(update.data.tokenHash).toBe(hashSecret(result.token));
      expect(update.data.tokenHash).not.toBe(result.token);
      expect(update.data.pairingCodeHash).toBeNull();
      expect(update.where).toEqual({
        id: 'dev-1',
        tokenHash: null,
        pairingCodeHash: hashPairingCode('123456', config.pairingSecret),
      });
      expect(prisma.printDevice.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            pairingCodeHash: hashPairingCode('123456', config.pairingSecret),
            tokenHash: null,
            pairingExpiresAt: { gt: expect.any(Date) },
          }),
        }),
      );
      expect(audit.record).toHaveBeenCalledWith(
        null,
        expect.objectContaining({ action: 'PRINT_DEVICE_PAIRED' }),
      );
      expect(JSON.stringify(audit.record.mock.calls)).not.toContain(
        result.token,
      );
    });

    it('rejects an unknown or expired code', async () => {
      const { prisma, service } = setup();

      prisma.printDevice.findFirst.mockResolvedValue(null);

      await expect(service.pair(dto, { ip: null })).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(prisma.printDevice.updateMany).not.toHaveBeenCalled();
    });

    it('loses the race when another request already consumed the code', async () => {
      const { prisma, service } = setup();

      prisma.printDevice.findFirst.mockResolvedValue({
        id: 'dev-1',
        branchId: 'br-1',
        branch: { restaurantId: 'rest-1' },
      });
      prisma.printDevice.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.pair(dto, { ip: null })).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('blocks repeated failures of the same code', async () => {
      const { prisma, service } = setup();

      prisma.printDevice.findFirst.mockResolvedValue(null);

      for (let i = 0; i < 5; i += 1) {
        await expect(
          service.pair(dto, { ip: `9.9.9.${i}` }),
        ).rejects.toBeInstanceOf(BadRequestException);
      }

      const blocked = await service
        .pair(dto, { ip: '9.9.9.99' })
        .catch((error: unknown) => error);

      expect(blocked).toMatchObject({ status: 429, retryAfterSeconds: 300 });
      expect(blocked).toBeInstanceOf(PairingThrottledException);
    });

    it('lifts the lockout after 5 minutes and reports the remaining time', async () => {
      const { prisma, service } = setup();
      const now = jest.spyOn(Date, 'now');

      prisma.printDevice.findFirst.mockResolvedValue(null);
      now.mockReturnValue(1_000_000);

      for (let i = 0; i < 5; i += 1) {
        await service.pair(dto, { ip: `9.9.9.${i}` }).catch(() => undefined);
      }

      now.mockReturnValue(1_000_000 + 120_000);
      await expect(service.pair(dto, { ip: '9.9.9.99' })).rejects.toMatchObject(
        { status: 429, retryAfterSeconds: 180 },
      );

      now.mockReturnValue(1_000_000 + 300_001);
      await expect(
        service.pair(dto, { ip: '9.9.9.99' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      now.mockRestore();
    });

    it('blocks one ip after too many failures without locking other ips out', async () => {
      const { prisma, service } = setup();

      prisma.printDevice.findFirst.mockResolvedValue(null);

      for (let i = 0; i < 10; i += 1) {
        await expect(
          service.pair({ ...dto, code: String(100000 + i) }, { ip: '1.1.1.1' }),
        ).rejects.toBeInstanceOf(BadRequestException);
      }

      await expect(
        service.pair({ ...dto, code: '555555' }, { ip: '1.1.1.1' }),
      ).rejects.toMatchObject({ status: 429 });
      await expect(
        service.pair({ ...dto, code: '555555' }, { ip: '2.2.2.2' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('does not accept a plain sha256 of the code', async () => {
      const { prisma, service } = setup();

      prisma.printDevice.findFirst.mockResolvedValue(null);
      await expect(service.pair(dto, { ip: null })).rejects.toBeInstanceOf(
        BadRequestException,
      );

      const where = prisma.printDevice.findFirst.mock.calls[0][0].where;

      expect(where.pairingCodeHash).not.toBe(hashSecret('123456'));
    });
  });

  describe('claimNext', () => {
    it('claims scoped to the device and its branch with the device lease', async () => {
      const { queue, service } = setup();

      queue.claim.mockResolvedValue([claimed('j1', true)]);

      const jobs = await service.claimNext(ctx, 0);

      expect(queue.claim).toHaveBeenCalledWith({
        deviceId: 'dev-1',
        branchId: 'br-1',
        transports: [PrinterTransport.BROWSER],
        limit: 5,
        leaseSeconds: 45,
        claimedBy: null,
      });
      expect(jobs).toHaveLength(1);
      expect(jobs[0]).toMatchObject({
        jobId: 'j1',
        printerId: 'pr-1',
        displayNumber: '#01-023',
        attempt: 1,
        copies: 1,
        cut: true,
        retryUncertain: true,
      });
      expect(jobs[0].html).toContain('#01-023');
      expect(Buffer.from(jobs[0].escposBase64, 'base64')[0]).toBe(0x1b);
    });

    it('serves tablets both their app printers and browser printers', async () => {
      const { queue, service } = setup();

      await service.claimNext({ ...ctx, kind: PrintDeviceKind.ANDROID_APP }, 0);

      expect(queue.claim).toHaveBeenCalledWith(
        expect.objectContaining({
          transports: [PrinterTransport.APP_BRIDGE, PrinterTransport.BROWSER],
        }),
      );
    });

    it('times out with an empty list when nothing is due', async () => {
      const { queue, wake, service } = setup();

      await expect(service.claimNext(ctx, 0)).resolves.toEqual([]);
      expect(queue.claim).toHaveBeenCalledTimes(1);
      expect(wake.waitFor).not.toHaveBeenCalled();
    });

    it('waits on the branch wake signal and returns the job that arrives', async () => {
      const { queue, wake, service } = setup();

      queue.claim
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([claimed('j2')]);

      const jobs = await service.claimNext(ctx, 10);

      expect(wake.waitFor).toHaveBeenCalledTimes(1);
      expect(wake.waitFor).toHaveBeenCalledWith(
        'br-1',
        expect.any(Number),
        undefined,
      );
      expect(jobs.map((j) => j.jobId)).toEqual(['j2']);
    });

    it('stops waiting when the client aborts', async () => {
      const { queue, service } = setup();
      const abort = new AbortController();

      abort.abort();

      await expect(service.claimNext(ctx, 20, abort.signal)).resolves.toEqual(
        [],
      );
      expect(queue.claim).not.toHaveBeenCalled();
    });

    it('releases the claim when the client aborts while claiming', async () => {
      const { queue, service } = setup();
      const abort = new AbortController();

      queue.claim.mockImplementation(() => {
        abort.abort();

        return Promise.resolve([claimed('j1')]);
      });

      await expect(service.claimNext(ctx, 20, abort.signal)).resolves.toEqual(
        [],
      );
      expect(queue.release).toHaveBeenCalledWith(['j1'], 'dev-1');
    });

    it('never hands a device an app bridge printer with a disallowed host', async () => {
      const { queue, service } = setup();
      const bad = claimed('j7');

      bad.printer = {
        ...printer,
        transport: PrinterTransport.APP_BRIDGE,
        connection: { via: 'tcp', host: '169.254.169.254', port: 9100 },
      } as never;
      queue.claim.mockResolvedValue([bad]);

      await expect(
        service.claimNext({ ...ctx, kind: PrintDeviceKind.ANDROID_APP }, 0),
      ).resolves.toEqual([]);
      expect(queue.fail).toHaveBeenCalledWith(
        'j7',
        expect.objectContaining({
          code: 'INVALID_CONNECTION',
          retryable: false,
        }),
      );
    });

    it('delivers an app bridge printer on a private lan address', async () => {
      const { queue, service } = setup();
      const ok = claimed('j8');

      ok.printer = {
        ...printer,
        transport: PrinterTransport.APP_BRIDGE,
        connection: { via: 'tcp', host: '192.168.1.50', port: 9100 },
      } as never;
      queue.claim.mockResolvedValue([ok]);

      const jobs = await service.claimNext(
        { ...ctx, kind: PrintDeviceKind.ANDROID_APP },
        0,
      );

      expect(jobs[0].connection).toEqual({
        via: 'tcp',
        host: '192.168.1.50',
        port: 9100,
      });
    });

    it('does not hand the same job to two devices claiming at once', async () => {
      const { queue, service } = setup();
      const pool = ['j1', 'j2', 'j3'];

      queue.claim.mockImplementation(({ limit }: { limit: number }) =>
        Promise.resolve(pool.splice(0, limit).map((id) => claimed(id))),
      );

      const [a, b] = await Promise.all([
        service.claimNext({ ...ctx, deviceId: 'dev-a' }, 0),
        service.claimNext({ ...ctx, deviceId: 'dev-b' }, 0),
      ]);
      const ids = [...a, ...b].map((j) => j.jobId);

      expect(new Set(ids).size).toBe(ids.length);
      expect(ids.sort()).toEqual(['j1', 'j2', 'j3']);
    });

    it('fails a job without a valid document instead of delivering it', async () => {
      const { queue, service } = setup();
      const bad = claimed('j9');

      bad.job.document = {} as never;
      queue.claim.mockResolvedValue([bad]);

      await expect(service.claimNext(ctx, 0)).resolves.toEqual([]);
      expect(queue.fail).toHaveBeenCalledWith(
        'j9',
        expect.objectContaining({ code: 'INVALID_DOCUMENT', retryable: false }),
      );
    });
  });

  describe('ack, fail and extend', () => {
    it('only lets a device ack jobs of its branch on printers it serves', async () => {
      const { prisma, queue, service } = setup();
      const jobId = '11111111-1111-1111-1111-111111111111';

      prisma.printJob.findFirst.mockResolvedValue(null);

      await expect(service.ack(ctx, jobId, {})).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(prisma.printJob.findFirst).toHaveBeenCalledWith({
        where: {
          id: jobId,
          branchId: 'br-1',
          printer: { devices: { some: { deviceId: 'dev-1' } } },
        },
        select: { id: true },
      });
      expect(queue.ack).not.toHaveBeenCalled();
    });

    it('acks scoped to the branch and reports duplicates', async () => {
      const { prisma, queue, service } = setup();

      prisma.printJob.findFirst.mockResolvedValue({ id: 'j1' });
      queue.ack.mockResolvedValue('DUPLICATE');

      await expect(service.ack(ctx, 'j1', {})).resolves.toEqual({
        result: 'DUPLICATE',
      });
      expect(queue.ack).toHaveBeenCalledWith(
        'j1',
        expect.objectContaining({ branchId: 'br-1' }),
      );
    });

    it('clamps a printedAt far in the future', async () => {
      const { prisma, queue, service } = setup();

      prisma.printJob.findFirst.mockResolvedValue({ id: 'j1' });
      queue.ack.mockResolvedValue('PRINTED');

      await service.ack(ctx, 'j1', { printedAt: '2999-01-01T00:00:00Z' });

      const printedAt = (queue.ack.mock.calls[0][1] as { printedAt: Date })
        .printedAt;

      expect(printedAt.getTime()).toBeLessThan(Date.now() + 5000);
    });

    it('only lets the claiming device fail or extend a job', async () => {
      const { prisma, queue, service } = setup();

      prisma.printJob.findFirst.mockResolvedValue(null);

      await expect(
        service.fail(ctx, 'j1', { code: 'X', message: 'm', retryable: true }),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(service.extend(ctx, 'j1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(prisma.printJob.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'j1', branchId: 'br-1', claimedByDeviceId: 'dev-1' },
        }),
      );
      expect(queue.fail).not.toHaveBeenCalled();
      expect(queue.extend).not.toHaveBeenCalled();
    });

    it('passes the retryable flag and marks the printer in error', async () => {
      const { prisma, queue, service } = setup();

      prisma.printJob.findFirst.mockResolvedValue({ printerId: 'pr-1' });
      queue.fail.mockResolvedValue('PENDING');

      await expect(
        service.fail(ctx, 'j1', {
          code: 'BT_OFF',
          message: 'sin bluetooth',
          retryable: true,
        }),
      ).resolves.toEqual({ result: 'PENDING' });
      expect(queue.fail).toHaveBeenCalledWith('j1', {
        code: 'BT_OFF',
        message: 'sin bluetooth',
        retryable: true,
        branchId: 'br-1',
      });
      expect(prisma.printer.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'pr-1', branchId: 'br-1' },
        }),
      );
    });

    it('extends the lease of its own claim', async () => {
      const { prisma, queue, service } = setup();
      const lease = new Date('2026-11-25T15:00:00Z');

      prisma.printJob.findFirst.mockResolvedValue({ printerId: 'pr-1' });
      prisma.printJob.findUnique.mockResolvedValue({ leaseUntil: lease });
      queue.extend.mockResolvedValue(true);

      await expect(service.extend(ctx, 'j1')).resolves.toEqual({
        extended: true,
        leaseUntil: lease.toISOString(),
      });
      expect(queue.extend).toHaveBeenCalledWith('j1', 'br-1');
    });
  });

  describe('heartbeat', () => {
    it('ignores reports for printers the device does not serve', async () => {
      const { prisma, service } = setup();

      prisma.printDevicePrinter.findMany.mockResolvedValue([
        { printerId: 'pr-1' },
      ]);

      await service.heartbeat(ctx, {
        printers: [
          { printerId: 'pr-1', ok: false, detail: 'sin papel' },
          { printerId: 'foreign', ok: true },
        ],
      });

      const targets = prisma.printer.updateMany.mock.calls.map(
        (c) => (c[0] as { where: { id: unknown } }).where.id,
      );

      expect(targets).toEqual(['pr-1']);
      expect(prisma.printer.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'ERROR',
            lastError: 'sin papel',
          }),
        }),
      );
    });
  });

  describe('removeSelf', () => {
    it('deactivates the device and drops its token', async () => {
      const { prisma, audit, service } = setup();

      await service.removeSelf(ctx);

      expect(prisma.printDevice.update).toHaveBeenCalledWith({
        where: { id: 'dev-1' },
        data: { active: false, tokenHash: null },
      });
      expect(prisma.printJob.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            claimedByDeviceId: 'dev-1',
            status: 'CLAIMED',
          }),
          data: expect.objectContaining({
            status: 'PENDING',
            leaseUntil: null,
            lastError: 'DEVICE_REVOKED',
          }),
        }),
      );
      expect(audit.record).toHaveBeenCalledWith(
        null,
        expect.objectContaining({ action: 'PRINT_DEVICE_REVOKED' }),
      );
    });
  });
});

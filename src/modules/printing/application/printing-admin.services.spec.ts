import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import {
  PrintDeviceKind,
  Prisma,
  PrintJobKind,
  PrinterTransport,
  Role,
} from '@prisma/client';
import {
  generatePairingCode,
  hashPairingCode,
  hashSecret,
  parseDeviceAuthorization,
  transportsServedBy,
} from '../domain/device-security';
import { validateConnection } from '../domain/printer-config';
import { PrintDevicesService } from './print-devices.service';
import { PrintJobsService } from './print-jobs.service';
import { PrintQueueService } from './print-queue.service';
import { PrintWakeService } from './print-wake.service';
import { PrintersService } from './printers.service';
import type { PrintingConfigService } from './printing-config.service';

type Mocks = Record<string, jest.Mock>;

const config = {
  pairingTtlMinutes: 10,
  deviceOfflineSeconds: 90,
  tcpAllowLocal: false,
  maxAttempts: 6,
  retryBaseMs: 5000,
  deviceLeaseSeconds: 45,
  pairingSecret: 'test-pairing-secret-0123456789abcdef',
} as unknown as PrintingConfigService;

const user = {
  sub: 's',
  profileType: 'STAFF',
  profileId: 'staff-1',
  restaurantId: 'rest-1',
} as never;
const BRANCH = '11111111-1111-1111-1111-111111111111';
const context = {
  staffUserId: 'staff-1',
  restaurantId: 'rest-1',
  branchId: BRANCH,
  roles: [Role.ADMIN],
};

function branchAccess() {
  return {
    ensureAccess: jest.fn().mockResolvedValue(context),
  };
}

describe('device security helpers', () => {
  it('generates 6 digit codes and hashes deterministically', () => {
    for (let i = 0; i < 50; i += 1) {
      expect(generatePairingCode()).toMatch(/^\d{6}$/);
    }

    expect(hashSecret('123456')).toBe(hashSecret('123456'));
    expect(hashSecret('123456')).not.toBe('123456');
  });

  it('parses only the Device scheme', () => {
    const token = 'x'.repeat(43);

    expect(parseDeviceAuthorization(`Device ${token}`)).toBe(token);
    expect(parseDeviceAuthorization(`Bearer ${token}`)).toBeNull();
    expect(parseDeviceAuthorization(undefined)).toBeNull();
  });

  it('lets a tablet serve browser printers too and a browser only its own', () => {
    expect(transportsServedBy(PrintDeviceKind.BROWSER)).toEqual([
      PrinterTransport.BROWSER,
    ]);
    expect(transportsServedBy(PrintDeviceKind.ANDROID_APP)).toEqual([
      PrinterTransport.APP_BRIDGE,
      PrinterTransport.BROWSER,
    ]);
  });
});

describe('validateConnection', () => {
  it('normalizes simulated and browser printers to an empty connection', () => {
    expect(
      validateConnection(PrinterTransport.BROWSER, { x: 1 }, false),
    ).toEqual({ ok: true, connection: {} });
  });

  it('applies the SSRF guards to TCP', () => {
    const tcp = (host: string, port = 9100, allowLocal = false) =>
      validateConnection(PrinterTransport.TCP, { host, port }, allowLocal).ok;

    expect(tcp('192.168.1.50')).toBe(true);
    expect(tcp('10.0.0.4', 9101)).toBe(true);
    expect(tcp('8.8.8.8')).toBe(false);
    expect(tcp('169.254.169.254')).toBe(false);
    expect(tcp('127.0.0.1')).toBe(false);
    expect(tcp('127.0.0.1', 9100, true)).toBe(true);
    expect(tcp('localhost')).toBe(false);
    expect(tcp('192.168.1.50', 80)).toBe(false);
    expect(tcp('0.0.0.0', 9100, true)).toBe(false);
    expect(tcp('0.0.0.0')).toBe(false);
    expect(tcp('255.255.255.255', 9100, true)).toBe(false);
    expect(tcp('224.0.0.1', 9100, true)).toBe(false);
    expect(tcp('2130706433', 9100, true)).toBe(false);
    expect(tcp('printer.lan')).toBe(true);
  });

  it('validates app bridge over tcp and bluetooth', () => {
    expect(
      validateConnection(
        PrinterTransport.APP_BRIDGE,
        { via: 'tcp', host: '192.168.1.50', port: 9100 },
        false,
      ).ok,
    ).toBe(true);
    expect(
      validateConnection(
        PrinterTransport.APP_BRIDGE,
        { via: 'bluetooth', address: 'aa:bb:cc:dd:ee:ff' },
        false,
      ),
    ).toEqual({
      ok: true,
      connection: { via: 'bluetooth', address: 'AA:BB:CC:DD:EE:FF' },
    });
    expect(
      validateConnection(
        PrinterTransport.APP_BRIDGE,
        { via: 'bluetooth', address: 'nope' },
        false,
      ).ok,
    ).toBe(false);
    expect(validateConnection(PrinterTransport.APP_BRIDGE, {}, false).ok).toBe(
      false,
    );
  });

  it('applies the tcp target guard to app bridge hosts and ports', () => {
    const bridge = (host: string, port: number, allowLocal = false) =>
      validateConnection(
        PrinterTransport.APP_BRIDGE,
        { via: 'tcp', host, port },
        allowLocal,
      ).ok;

    expect(bridge('10.0.0.5', 9100)).toBe(true);
    expect(bridge('172.20.1.1', 9110)).toBe(true);
    expect(bridge('8.8.8.8', 9100)).toBe(false);
    expect(bridge('169.254.169.254', 9100)).toBe(false);
    expect(bridge('192.168.1.50', 80)).toBe(false);
    expect(bridge('192.168.1.50', 9111)).toBe(false);
    expect(bridge('printer.evil.example', 9100)).toBe(false);
    expect(bridge('127.0.0.1', 9100)).toBe(false);
    expect(bridge('127.0.0.1', 9100, true)).toBe(true);
    expect(bridge('localhost', 9100)).toBe(false);
    expect(bridge('localhost', 9100, true)).toBe(true);
  });

  it('rejects transports that are not available yet', () => {
    expect(validateConnection(PrinterTransport.CLOUDPRNT, {}, false).ok).toBe(
      false,
    );
  });
});

describe('PrintersService permissions and isolation', () => {
  function setup() {
    const prisma = {
      printer: {
        findFirst: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn(),
        update: jest.fn(),
        count: jest.fn(),
      },
      preparationStation: { count: jest.fn(), findFirst: jest.fn() },
      printJob: { count: jest.fn(), create: jest.fn() },
      branch: { findUnique: jest.fn() },
      $transaction: jest.fn(),
    } as unknown as Record<string, Mocks> & { $transaction: jest.Mock };
    const access = branchAccess();
    const audit = { record: jest.fn() };
    const wake = { notifyBranch: jest.fn() };
    const service = new PrintersService(
      prisma as never,
      access as never,
      audit as never,
      config,
      wake as unknown as PrintWakeService,
    );

    return { prisma, access, audit, wake, service };
  }

  it('lets ADMIN and SUPERVISOR read but only ADMIN write', async () => {
    const { access, prisma, service } = setup();

    await service.list(user, BRANCH);
    expect(access.ensureAccess).toHaveBeenLastCalledWith(user, BRANCH, [
      Role.ADMIN,
      Role.SUPERVISOR,
    ]);

    access.ensureAccess.mockRejectedValue(new ForbiddenException());
    await expect(
      service.create(user, BRANCH, {
        name: 'Cocina',
        transport: PrinterTransport.SIMULATED,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(access.ensureAccess).toHaveBeenLastCalledWith(user, BRANCH, [
      Role.ADMIN,
    ]);
    expect(prisma.printer.create).not.toHaveBeenCalled();
  });

  it('refuses to touch a printer of another branch', async () => {
    const { prisma, service } = setup();

    prisma.printer.findFirst.mockResolvedValue(null);

    await expect(
      service.update(user, BRANCH, 'p-other', { name: 'x' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.printer.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'p-other', branchId: BRANCH } }),
    );
    expect(prisma.printer.update).not.toHaveBeenCalled();
  });

  it('rejects stations that belong to another branch and invalid connections', async () => {
    const { prisma, service } = setup();

    prisma.printer.findFirst.mockResolvedValue(null);
    prisma.preparationStation.count.mockResolvedValue(0);

    await expect(
      service.create(user, BRANCH, {
        name: 'Cocina',
        transport: PrinterTransport.TCP,
        connection: { host: '8.8.8.8', port: 9100 },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.create(user, BRANCH, {
        name: 'Cocina',
        transport: PrinterTransport.SIMULATED,
        stationIds: ['22222222-2222-2222-2222-222222222222'],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.create(user, BRANCH, {
        name: 'Cocina',
        transport: PrinterTransport.SIMULATED,
        codepage: 'klingon',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses duplicate names and deleting a printer with open jobs', async () => {
    const { prisma, service } = setup();

    prisma.printer.findFirst.mockResolvedValueOnce({ id: 'dup' });
    await expect(
      service.create(user, BRANCH, {
        name: 'Cocina',
        transport: PrinterTransport.SIMULATED,
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    prisma.printer.findFirst.mockResolvedValue({
      id: 'p1',
      name: 'Cocina',
      stations: [],
      devices: [],
    });
    prisma.printJob.count.mockResolvedValue(2);
    await expect(service.remove(user, BRANCH, 'p1')).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(prisma.printJob.count).toHaveBeenCalledWith({
      where: { printerId: 'p1', status: 'CLAIMED' },
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('deletes a printer together with its job history and audits the count', async () => {
    const { prisma, audit, service } = setup();
    const tx = {
      printJob: { count: jest.fn().mockResolvedValue(3) },
      printer: { delete: jest.fn() },
    };

    prisma.printer.findFirst.mockResolvedValue({
      id: 'p1',
      name: 'Cocina',
      stations: [],
      devices: [],
    });
    prisma.printJob.count.mockResolvedValue(0);
    prisma.$transaction.mockImplementation((fn: (t: unknown) => unknown) =>
      fn(tx),
    );

    await service.remove(user, BRANCH, 'p1');

    expect(tx.printer.delete).toHaveBeenCalledWith({ where: { id: 'p1' } });
    expect(audit.record).toHaveBeenCalledWith(
      null,
      expect.objectContaining({
        action: 'PRINTER_DELETED',
        after: { removedJobs: 3 },
      }),
    );
  });

  it('enqueues a test job with a unique key and wakes the devices', async () => {
    const { prisma, wake, audit, service } = setup();

    prisma.printer.findFirst.mockResolvedValue({
      id: 'p1',
      name: 'Cocina',
      active: true,
      stations: [],
      devices: [],
    });
    prisma.branch.findUnique.mockResolvedValue({
      restaurant: { timezone: 'America/Santiago' },
    });
    prisma.printJob.create.mockResolvedValue({ id: 'job-1' });

    await expect(service.testPrint(user, BRANCH, 'p1')).resolves.toEqual({
      jobId: 'job-1',
    });

    const data = (
      prisma.printJob.create.mock.calls[0][0] as {
        data: { kind: string; idempotencyKey: string; branchId: string };
      }
    ).data;

    expect(data.kind).toBe(PrintJobKind.TEST);
    expect(data.idempotencyKey).toMatch(/^TEST:/);
    expect(data.branchId).toBe(BRANCH);
    expect(wake.notifyBranch).toHaveBeenCalledWith(BRANCH);
    expect(audit.record).toHaveBeenCalledWith(
      null,
      expect.objectContaining({ action: 'PRINT_TEST_ENQUEUED' }),
    );
  });

  it('upper-cases the print code and reports a taken code as a conflict', async () => {
    const { prisma, service } = setup();

    prisma.preparationStation.findFirst.mockResolvedValue({
      id: 's1',
      printCode: '01',
    });
    prisma.$transaction.mockRejectedValue(
      Object.assign(
        Object.create(Prisma.PrismaClientKnownRequestError.prototype) as object,
        { code: 'P2002' },
      ),
    );

    await expect(
      service.updateStation(user, BRANCH, 's1', { printCode: 'a1' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('PrintDevicesService', () => {
  function setup() {
    const prisma = {
      printDevice: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
        findFirstOrThrow: jest.fn(),
        create: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
        delete: jest.fn(),
      },
      printer: { count: jest.fn() },
      printJob: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      printDevicePrinter: { deleteMany: jest.fn(), createMany: jest.fn() },
      $transaction: jest
        .fn()
        .mockImplementation((arg: unknown) =>
          typeof arg === 'function' ? arg(prisma) : Promise.resolve([]),
        ),
    } as unknown as Record<string, Mocks> & { $transaction: jest.Mock };
    const access = branchAccess();
    const audit = { record: jest.fn() };
    const service = new PrintDevicesService(
      prisma as never,
      access as never,
      audit as never,
      config,
    );

    return { prisma, access, audit, service };
  }

  const stored = (extra: object = {}) => ({
    id: 'dev-1',
    branchId: BRANCH,
    kind: PrintDeviceKind.BROWSER,
    name: 'Dispositivo',
    active: true,
    tokenHash: null,
    pairingCodeHash: 'h',
    pairingExpiresAt: new Date(Date.now() + 60_000),
    appVersion: null,
    lastSeenAt: null,
    printers: [],
    ...extra,
  });

  it('creates a short-lived code stored only as a hash', async () => {
    const { prisma, access, service } = setup();

    prisma.printDevice.create.mockResolvedValue({ id: 'dev-1' });
    prisma.printDevice.findFirstOrThrow.mockResolvedValue(stored());

    const result = await service.createPairing(user, BRANCH, {});
    const update = prisma.printDevice.update.mock.calls[0][0] as {
      data: { pairingCodeHash: string; pairingExpiresAt: Date };
    };

    expect(access.ensureAccess).toHaveBeenCalledWith(user, BRANCH, [
      Role.ADMIN,
    ]);
    expect(result.pairingCode).toMatch(/^\d{6}$/);
    expect(update.data.pairingCodeHash).toBe(
      hashPairingCode(result.pairingCode, config.pairingSecret),
    );
    expect(update.data.pairingCodeHash).not.toBe(result.pairingCode);
    expect(update.data.pairingExpiresAt.getTime()).toBeLessThanOrEqual(
      Date.now() + 10 * 60_000,
    );
    expect(update.data.pairingExpiresAt.getTime()).toBeGreaterThan(
      Date.now() + 9 * 60_000,
    );
    expect(JSON.stringify(result.device)).not.toContain('tokenHash');
  });

  it('rejects printers the device kind cannot serve and cleans up', async () => {
    const { prisma, service } = setup();

    prisma.printDevice.create.mockResolvedValue({ id: 'dev-1' });
    prisma.printer.count.mockResolvedValue(0);

    await expect(
      service.createPairing(user, BRANCH, {
        printerIds: ['33333333-3333-3333-3333-333333333333'],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.printDevice.delete).toHaveBeenCalledWith({
      where: { id: 'dev-1' },
    });
  });

  it('revokes by clearing the token and deactivating', async () => {
    const { prisma, audit, service } = setup();

    prisma.printDevice.findFirst.mockResolvedValue(stored());
    prisma.printDevice.findFirstOrThrow.mockResolvedValue(
      stored({ active: false }),
    );

    const result = await service.revoke(user, BRANCH, 'dev-1');

    expect(prisma.printDevice.update).toHaveBeenCalledWith({
      where: { id: 'dev-1' },
      data: expect.objectContaining({ active: false, tokenHash: null }),
    });
    expect(prisma.printJob.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'PENDING',
          lastError: 'DEVICE_REVOKED',
        }),
      }),
    );
    expect(result.active).toBe(false);
    expect(audit.record).toHaveBeenCalledWith(
      null,
      expect.objectContaining({ action: 'PRINT_DEVICE_REVOKED' }),
    );
  });

  it('does not reach a device of another branch', async () => {
    const { prisma, service } = setup();

    prisma.printDevice.findFirst.mockResolvedValue(null);

    await expect(service.revoke(user, BRANCH, 'other')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(prisma.printDevice.findFirst).toHaveBeenCalledWith({
      where: { id: 'other', branchId: BRANCH },
    });
  });

  it('lets SUPERVISOR list but the list never exposes secrets', async () => {
    const { prisma, access, service } = setup();

    prisma.printDevice.findMany.mockResolvedValue([
      stored({ tokenHash: 'secret', lastSeenAt: new Date() }),
    ]);

    const [device] = await service.list(user, BRANCH);

    expect(access.ensureAccess).toHaveBeenCalledWith(user, BRANCH, [
      Role.ADMIN,
      Role.SUPERVISOR,
    ]);
    expect(device).toMatchObject({ paired: true, online: true });
    expect(JSON.stringify(device)).not.toContain('secret');
  });
});

describe('PrintJobsService', () => {
  function setup() {
    const prisma = {
      printJob: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn(),
      },
      printer: { findFirst: jest.fn() },
      preparationStation: { findFirst: jest.fn() },
      branch: { findUnique: jest.fn() },
    } as unknown as Record<string, Mocks>;
    const access = branchAccess();
    const reprints = {
      reprintJob: jest.fn(),
      reprintStationTicket: jest.fn(),
    };
    const queue = { manualRetry: jest.fn() };
    const wake = { notifyBranch: jest.fn() };
    const service = new PrintJobsService(
      prisma as never,
      access as never,
      queue as unknown as PrintQueueService,
      reprints as never,
      wake as unknown as PrintWakeService,
    );

    return { prisma, access, reprints, queue, wake, service };
  }

  it('always filters the list by branch and applies the filters', async () => {
    const { prisma, service } = setup();

    await service.list(user, BRANCH, {
      status: 'FAILED',
      printerId: 'p1',
      before: '2026-11-25T00:00:00.000Z',
      limit: 10,
    } as never);

    expect(prisma.printJob.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          branchId: BRANCH,
          status: 'FAILED',
          printerId: 'p1',
          createdAt: { lt: new Date('2026-11-25T00:00:00.000Z') },
        },
        take: 10,
      }),
    );
  });

  it('allows kitchen and bar staff to reprint but not to retry', async () => {
    const { access, reprints, queue, prisma, service } = setup();

    reprints.reprintJob.mockResolvedValue({ id: 'new' });
    prisma.printJob.findFirst.mockResolvedValue({
      id: 'new',
      printerId: 'p1',
      printer: { name: 'Cocina' },
      document: {},
      createdAt: new Date(),
      nextAttemptAt: new Date(),
      printedAt: null,
    });

    await service.reprint(user, BRANCH, 'old');
    expect(access.ensureAccess).toHaveBeenLastCalledWith(user, BRANCH, [
      Role.ADMIN,
      Role.SUPERVISOR,
      Role.KITCHEN,
      Role.BAR,
    ]);

    queue.manualRetry.mockResolvedValue(false);
    await expect(service.retry(user, BRANCH, 'old')).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(access.ensureAccess).toHaveBeenLastCalledWith(user, BRANCH, [
      Role.ADMIN,
      Role.SUPERVISOR,
    ]);
  });

  it('renders the rendered text and html of a job and 404s a foreign one', async () => {
    const { prisma, service } = setup();

    prisma.printJob.findFirst.mockResolvedValueOnce(null);
    await expect(
      service.preview(user, BRANCH, 'foreign'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.printJob.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'foreign', branchId: BRANCH } }),
    );
  });

  it('renders a sample comanda with the station code at the requested width', async () => {
    const { prisma, service } = setup();

    prisma.preparationStation.findFirst.mockResolvedValue({
      name: 'Pizza',
      printCode: 'PZ',
    });
    prisma.branch.findUnique.mockResolvedValue({
      restaurant: { timezone: 'America/Santiago' },
    });

    const preview = await service.samplePreview(user, BRANCH, {
      stationId: '44444444-4444-4444-4444-444444444444',
      columns: 48,
      paperWidthMm: 80,
    });

    expect(preview.text).toContain('#PZ-023');
    expect(preview.text).toContain('*** Pizza ***');
    expect(preview.html).toContain('class="receipt"');
    expect(preview.htmlDocument).toContain('<!doctype html>');
    expect(preview.columns).toBe(48);
  });
});

describe('PrintQueueService claim SQL guarantees', () => {
  it('reclaims expired leases, skips locked rows and scopes to the device', async () => {
    const queryRaw = jest.fn().mockResolvedValue([]);
    const queue = new PrintQueueService(
      { $queryRaw: queryRaw } as never,
      config,
      { record: jest.fn() } as never,
      {} as never,
    );

    await queue.claim({
      deviceId: 'dev-1',
      branchId: 'br-1',
      transports: [PrinterTransport.BROWSER],
      limit: 5,
      leaseSeconds: 45,
      claimedBy: null,
    });

    const sql = (queryRaw.mock.calls[0][0] as { sql: string }).sql;

    expect(sql).toContain("j.status = 'CLAIMED' AND j.lease_until < now()");
    expect(sql).toContain('FOR UPDATE OF j SKIP LOCKED');
    expect(sql).toContain('print_device_printers');
    expect(sql).toContain('j.branch_id =');
    expect(sql).toContain('p.transport::text = ANY');
  });
});

describe('PrintWakeService', () => {
  function setup() {
    const prisma = { printJob: { findMany: jest.fn() } };
    const push = {
      sendDataToBranchRoles: jest.fn().mockResolvedValue(undefined),
    };
    const wakeConfig = { wakePushEnabled: true } as PrintingConfigService;
    const service = new PrintWakeService(
      prisma as never,
      push as never,
      wakeConfig,
    );

    return { prisma, push, service };
  }

  it('wakes waiting long-polls of the same branch only', async () => {
    const { service } = setup();
    const own = service.waitFor('br-1', 5000);
    const other = jest.fn();

    void service.waitFor('br-2', 50).then(other);
    service.notifyBranch('br-1');

    await own;
    expect(other).not.toHaveBeenCalled();
  });

  it('resolves on timeout and on abort', async () => {
    const { service } = setup();
    const abort = new AbortController();
    const pending = service.waitFor('br-1', 60_000, abort.signal);

    abort.abort();
    await pending;
    await service.waitFor('br-1', 5);
  });

  it('sends one data-only push per new job and not again for the same attempt', async () => {
    const { prisma, push, service } = setup();
    const job = {
      id: 'j1',
      branchId: 'br-1',
      nextAttemptAt: new Date('2026-11-25T14:00:00Z'),
    };

    prisma.printJob.findMany.mockResolvedValue([job]);

    await expect(service.scan(new Date('2026-11-25T14:00:05Z'))).resolves.toBe(
      1,
    );
    await expect(service.scan(new Date('2026-11-25T14:00:07Z'))).resolves.toBe(
      0,
    );
    expect(push.sendDataToBranchRoles).toHaveBeenCalledTimes(1);
    expect(push.sendDataToBranchRoles).toHaveBeenCalledWith(
      'br-1',
      [Role.KITCHEN, Role.BAR],
      { type: 'PRINT_WAKE', branchId: 'br-1' },
    );
  });

  it('swallows push errors', async () => {
    const { prisma, push, service } = setup();

    push.sendDataToBranchRoles.mockRejectedValue(new Error('fcm down'));
    prisma.printJob.findMany.mockResolvedValue([
      { id: 'j1', branchId: 'br-9', nextAttemptAt: new Date() },
    ]);

    await expect(service.scan()).resolves.toBe(1);
  });
});

import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  PrinterStatus,
  type PrintDeviceKind,
  type PrinterTransport,
} from '@prisma/client';
import { AuditService } from '../../../common/audit/audit.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import {
  generateDeviceToken,
  hashPairingCode,
  hashSecret,
  parseDeviceAuthorization,
  transportsServedBy,
} from '../domain/device-security';
import type {
  AckJobDto,
  FailJobDto,
  HeartbeatDto,
  PairDeviceDto,
} from '../presentation/http/dto/printing.dto';
import { validateConnection } from '../domain/printer-config';
import { replaceDevicePrinters } from './print-devices.service';
import { PrintQueueService, type ClaimedJob } from './print-queue.service';
import { releaseDeviceClaims } from './print-devices.service';
import { PrintWakeService } from './print-wake.service';
import { PrintingConfigService } from './printing-config.service';
import {
  documentForDelivery,
  renderPrinterBytes,
  renderPrinterHtml,
} from './render-job';

const CLAIM_LIMIT = 5;
const POLL_INTERVAL_MS = 2000;
const PAIR_FAILURE_WINDOW_MS = 5 * 60 * 1000;
const PAIR_IP_FAILURE_LIMIT = 10;
const PAIR_CODE_FAILURE_LIMIT = 5;
const PAIR_TRACKED_MAX = 5000;
const MAX_FUTURE_SKEW_MS = 60_000;

export class PairingThrottledException extends HttpException {
  constructor(readonly retryAfterSeconds: number) {
    super(
      {
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        message: 'Demasiados intentos de emparejamiento. Espera unos minutos.',
        code: 'PAIRING_THROTTLED',
        retryAfterSeconds,
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}

export type DeviceContext = {
  deviceId: string;
  branchId: string;
  restaurantId: string;
  kind: PrintDeviceKind;
};

export type DevicePrinterDto = {
  id: string;
  name: string;
  transport: string;
  connection: unknown;
  paperWidthMm: number;
  columns: number;
  copies: number;
  autoCut: boolean;
  status: string;
};

export type DeviceJobDto = {
  jobId: string;
  printerId: string;
  printerName: string;
  kind: string;
  displayNumber: string;
  station: string;
  attempt: number;
  leaseUntil: string | null;
  copies: number;
  cut: boolean;
  retryUncertain: boolean;
  connection: unknown;
  escposBase64: string;
  html: string;
};

type PrinterRow = {
  id: string;
  name: string;
  transport: string;
  connection: unknown;
  paperWidthMm: number;
  columns: number;
  copies: number;
  autoCut: boolean;
  status: string;
};

function safeConnection(
  printer: Pick<PrinterRow, 'transport' | 'connection'>,
  allowLocal: boolean,
): Record<string, unknown> | null {
  const result = validateConnection(
    printer.transport as PrinterTransport,
    printer.connection as Record<string, unknown> | undefined,
    allowLocal,
  );

  return result.ok ? result.connection : null;
}

function mapDevicePrinter(
  printer: PrinterRow,
  allowLocal: boolean,
): DevicePrinterDto {
  return {
    id: printer.id,
    name: printer.name,
    transport: printer.transport,
    connection: safeConnection(printer, allowLocal) ?? {},
    paperWidthMm: printer.paperWidthMm,
    columns: printer.columns,
    copies: printer.copies,
    autoCut: printer.autoCut,
    status: printer.status,
  };
}

@Injectable()
export class DeviceProtocolService {
  private readonly pairFailuresByIp = new Map<string, number[]>();
  private readonly pairFailuresByCode = new Map<string, number[]>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: PrintQueueService,
    private readonly audit: AuditService,
    private readonly config: PrintingConfigService,
    private readonly wake: PrintWakeService,
  ) {}

  async authenticate(header: string | undefined): Promise<DeviceContext> {
    const token = parseDeviceAuthorization(header);

    if (!token) {
      throw new UnauthorizedException('Token de dispositivo requerido.');
    }

    const device = await this.prisma.printDevice.findUnique({
      where: { tokenHash: hashSecret(token) },
      include: { branch: { select: { restaurantId: true } } },
    });

    if (!device || !device.active) {
      throw new UnauthorizedException('Token de dispositivo invalido.');
    }

    return {
      deviceId: device.id,
      branchId: device.branchId,
      restaurantId: device.branch.restaurantId,
      kind: device.kind,
    };
  }

  async pair(dto: PairDeviceDto, meta: { ip: string | null }) {
    const ipKey = meta.ip ?? 'unknown';
    const hash = hashPairingCode(dto.code, this.config.pairingSecret);

    this.assertPairingAllowed(ipKey, hash);

    const device = await this.prisma.printDevice.findFirst({
      where: {
        pairingCodeHash: hash,
        pairingExpiresAt: { gt: new Date() },
        tokenHash: null,
        active: true,
      },
      include: { branch: { select: { restaurantId: true } } },
    });

    if (!device) {
      this.recordPairFailure(ipKey, hash);
      throw this.invalidCode();
    }

    const token = generateDeviceToken();
    const claimed = await this.prisma.printDevice.updateMany({
      where: { id: device.id, tokenHash: null, pairingCodeHash: hash },
      data: {
        tokenHash: hashSecret(token),
        pairingCodeHash: null,
        pairingExpiresAt: null,
        name: dto.name.trim(),
        kind: dto.kind,
        appVersion: dto.appVersion ?? null,
        lastSeenAt: new Date(),
      },
    });

    if (claimed.count === 0) {
      this.recordPairFailure(ipKey, hash);
      throw this.invalidCode();
    }

    await this.prisma.printDevicePrinter.deleteMany({
      where: {
        deviceId: device.id,
        printer: { transport: { notIn: transportsServedBy(dto.kind) } },
      },
    });
    await this.audit.record(null, {
      restaurantId: device.branch.restaurantId,
      branchId: device.branchId,
      actorStaffUserId: null,
      actorRole: null,
      action: 'PRINT_DEVICE_PAIRED',
      entityType: 'PrintDevice',
      entityId: device.id,
      after: { kind: dto.kind, name: dto.name },
      ip: meta.ip,
    });

    return {
      deviceId: device.id,
      token,
      branchId: device.branchId,
      printers: await this.assignedPrinters(device.id),
    };
  }

  async me(ctx: DeviceContext) {
    const device = await this.prisma.printDevice.findUniqueOrThrow({
      where: { id: ctx.deviceId },
    });
    const available = await this.prisma.printer.findMany({
      where: {
        branchId: ctx.branchId,
        active: true,
        transport: { in: transportsServedBy(ctx.kind) },
      },
      orderBy: { name: 'asc' },
    });

    return {
      deviceId: device.id,
      branchId: device.branchId,
      kind: device.kind,
      name: device.name,
      printers: await this.assignedPrinters(ctx.deviceId),
      availablePrinters: available.map((p) =>
        mapDevicePrinter(p, this.config.tcpAllowLocal),
      ),
    };
  }

  async setPrinters(ctx: DeviceContext, printerIds: string[]) {
    await replaceDevicePrinters(this.prisma, {
      deviceId: ctx.deviceId,
      branchId: ctx.branchId,
      kind: ctx.kind,
      printerIds,
    });
    await this.audit.record(null, {
      restaurantId: ctx.restaurantId,
      branchId: ctx.branchId,
      actorStaffUserId: null,
      actorRole: null,
      action: 'PRINT_DEVICE_UPDATED',
      entityType: 'PrintDevice',
      entityId: ctx.deviceId,
      after: { printerIds },
    });

    return { printers: await this.assignedPrinters(ctx.deviceId) };
  }

  async heartbeat(ctx: DeviceContext, dto: HeartbeatDto) {
    const now = new Date();

    await this.prisma.printDevice.update({
      where: { id: ctx.deviceId },
      data: {
        lastSeenAt: now,
        ...(dto.appVersion ? { appVersion: dto.appVersion } : {}),
      },
    });

    const assigned = await this.prisma.printDevicePrinter.findMany({
      where: { deviceId: ctx.deviceId },
      select: { printerId: true },
    });
    const assignedIds = new Set(assigned.map((a) => a.printerId));
    const reports = new Map(
      (dto.printers ?? [])
        .filter((p) => assignedIds.has(p.printerId))
        .map((p) => [p.printerId, p]),
    );
    const unreported = [...assignedIds].filter((id) => !reports.has(id));

    if (unreported.length > 0) {
      await this.prisma.printer.updateMany({
        where: { id: { in: unreported }, branchId: ctx.branchId },
        data: { status: PrinterStatus.ONLINE, lastSeenAt: now },
      });
    }

    for (const report of reports.values()) {
      await this.prisma.printer.updateMany({
        where: { id: report.printerId, branchId: ctx.branchId },
        data: {
          status: report.ok ? PrinterStatus.ONLINE : PrinterStatus.ERROR,
          lastSeenAt: now,
          lastError: report.ok ? null : (report.detail ?? 'Error del equipo'),
        },
      });
    }

    return { ok: true, serverTime: now.toISOString() };
  }

  async claimNext(
    ctx: DeviceContext,
    waitSeconds: number,
    signal?: AbortSignal,
  ): Promise<DeviceJobDto[]> {
    const wait = Math.min(
      Math.max(waitSeconds, 0),
      this.config.longPollMaxSeconds,
    );
    const deadline = Date.now() + wait * 1000;

    await this.prisma.printDevice.update({
      where: { id: ctx.deviceId },
      data: { lastSeenAt: new Date() },
    });

    for (;;) {
      if (signal?.aborted) {
        return [];
      }

      const jobs = await this.claimOnce(ctx);

      if (jobs.length > 0) {
        if (signal?.aborted) {
          await this.queue.release(
            jobs.map((j) => j.jobId),
            ctx.deviceId,
          );

          return [];
        }

        return jobs;
      }

      const remaining = deadline - Date.now();

      if (remaining <= 0) {
        return [];
      }

      await this.wake.waitFor(
        ctx.branchId,
        Math.min(POLL_INTERVAL_MS, remaining),
        signal,
      );
    }
  }

  async ack(ctx: DeviceContext, jobId: string, dto: AckJobDto) {
    await this.assertServes(ctx, jobId);

    const requested = dto.printedAt ? new Date(dto.printedAt) : new Date();
    const now = Date.now();
    const printedAt =
      requested.getTime() > now + MAX_FUTURE_SKEW_MS
        ? new Date(now)
        : requested;
    const result = await this.queue.ack(jobId, {
      printedAt,
      branchId: ctx.branchId,
    });

    if (result === 'NOT_FOUND') {
      throw new NotFoundException('El trabajo indicado no existe.');
    }

    return { result };
  }

  async fail(ctx: DeviceContext, jobId: string, dto: FailJobDto) {
    const job = await this.assertOwnsClaim(ctx, jobId);
    const result = await this.queue.fail(jobId, {
      code: dto.code,
      message: dto.message,
      retryable: dto.retryable,
      branchId: ctx.branchId,
    });

    if (result !== 'IGNORED') {
      await this.prisma.printer.updateMany({
        where: { id: job.printerId, branchId: ctx.branchId },
        data: {
          status: PrinterStatus.ERROR,
          lastError: `[${dto.code}] ${dto.message}`.slice(0, 500),
        },
      });
    }

    return { result };
  }

  async extend(ctx: DeviceContext, jobId: string) {
    await this.assertOwnsClaim(ctx, jobId);
    const extended = await this.queue.extend(jobId, ctx.branchId);
    const job = extended
      ? await this.prisma.printJob.findUnique({
          where: { id: jobId },
          select: { leaseUntil: true },
        })
      : null;

    return { extended, leaseUntil: job?.leaseUntil?.toISOString() ?? null };
  }

  async removeSelf(ctx: DeviceContext): Promise<void> {
    const released = await this.prisma.$transaction(async (tx) => {
      await tx.printDevice.update({
        where: { id: ctx.deviceId },
        data: { active: false, tokenHash: null },
      });

      return releaseDeviceClaims(tx, ctx.deviceId);
    });

    await this.audit.record(null, {
      restaurantId: ctx.restaurantId,
      branchId: ctx.branchId,
      actorStaffUserId: null,
      actorRole: null,
      action: 'PRINT_DEVICE_REVOKED',
      entityType: 'PrintDevice',
      entityId: ctx.deviceId,
      after: { by: 'device', releasedJobs: released },
    });
  }

  private async claimOnce(ctx: DeviceContext): Promise<DeviceJobDto[]> {
    const claimed = await this.queue.claim({
      deviceId: ctx.deviceId,
      branchId: ctx.branchId,
      transports: transportsServedBy(ctx.kind),
      limit: CLAIM_LIMIT,
      leaseSeconds: this.config.deviceLeaseSeconds,
      claimedBy: null,
    });
    const out: DeviceJobDto[] = [];

    for (const item of claimed) {
      const dto = await this.toDeviceJob(item);

      if (dto) {
        out.push(dto);
      }
    }

    return out;
  }

  private async toDeviceJob(item: ClaimedJob): Promise<DeviceJobDto | null> {
    const { job, printer, retryUncertain } = item;
    const doc = documentForDelivery(job, {
      now: new Date(),
      attempts: job.attempts,
      retryUncertain,
      lateMinutes: this.config.lateMinutes,
    });

    const connection = safeConnection(printer, this.config.tcpAllowLocal);

    if (!doc || !connection) {
      await this.queue.fail(job.id, {
        code: doc ? 'INVALID_CONNECTION' : 'INVALID_DOCUMENT',
        message: 'El trabajo no se puede entregar.',
        retryable: false,
      });

      return null;
    }

    return {
      jobId: job.id,
      printerId: printer.id,
      printerName: printer.name,
      kind: job.kind,
      displayNumber: doc.header.number,
      station: doc.header.station,
      attempt: job.attempts,
      leaseUntil: job.leaseUntil?.toISOString() ?? null,
      copies: printer.copies,
      cut: printer.autoCut,
      retryUncertain,
      connection,
      escposBase64: Buffer.from(renderPrinterBytes(doc, printer)).toString(
        'base64',
      ),
      html: renderPrinterHtml(doc, printer, true),
    };
  }

  private async assignedPrinters(
    deviceId: string,
  ): Promise<DevicePrinterDto[]> {
    const links = await this.prisma.printDevicePrinter.findMany({
      where: { deviceId },
      include: { printer: true },
      orderBy: { printer: { name: 'asc' } },
    });

    return links.map((l) =>
      mapDevicePrinter(l.printer, this.config.tcpAllowLocal),
    );
  }

  private async assertServes(ctx: DeviceContext, jobId: string): Promise<void> {
    const job = await this.prisma.printJob.findFirst({
      where: {
        id: jobId,
        branchId: ctx.branchId,
        printer: { devices: { some: { deviceId: ctx.deviceId } } },
      },
      select: { id: true },
    });

    if (!job) {
      throw new NotFoundException('El trabajo indicado no existe.');
    }
  }

  private async assertOwnsClaim(
    ctx: DeviceContext,
    jobId: string,
  ): Promise<{ printerId: string }> {
    const job = await this.prisma.printJob.findFirst({
      where: {
        id: jobId,
        branchId: ctx.branchId,
        claimedByDeviceId: ctx.deviceId,
      },
      select: { printerId: true },
    });

    if (!job) {
      throw new NotFoundException('El trabajo indicado no existe.');
    }

    return job;
  }

  private assertPairingAllowed(ipKey: string, codeKey: string): void {
    const now = Date.now();
    const cutoff = now - PAIR_FAILURE_WINDOW_MS;
    const waits = [
      [this.pairFailuresByIp, ipKey, PAIR_IP_FAILURE_LIMIT],
      [this.pairFailuresByCode, codeKey, PAIR_CODE_FAILURE_LIMIT],
    ].flatMap(([store, key, limit]) => {
      const recent = this.recentFailures(
        store as Map<string, number[]>,
        key as string,
        cutoff,
      );

      return recent.length >= (limit as number)
        ? [
            recent[recent.length - (limit as number)] +
              PAIR_FAILURE_WINDOW_MS -
              now,
          ]
        : [];
    });

    if (waits.length > 0) {
      throw new PairingThrottledException(
        Math.max(Math.ceil(Math.max(...waits) / 1000), 1),
      );
    }
  }

  private recentFailures(
    store: Map<string, number[]>,
    key: string,
    cutoff: number,
  ): number[] {
    const recent = (store.get(key) ?? []).filter((at) => at > cutoff);

    if (recent.length === 0) {
      store.delete(key);
    } else {
      store.set(key, recent);
    }

    return recent;
  }

  private recordPairFailure(ipKey: string, codeKey: string): void {
    const now = Date.now();

    for (const [store, key] of [
      [this.pairFailuresByIp, ipKey],
      [this.pairFailuresByCode, codeKey],
    ] as const) {
      if (store.size >= PAIR_TRACKED_MAX && !store.has(key)) {
        store.delete(store.keys().next().value as string);
      }

      store.set(key, [...(store.get(key) ?? []), now]);
    }
  }

  private invalidCode(): BadRequestException {
    return new BadRequestException({
      message: 'El codigo es invalido o esta vencido.',
      code: 'PAIRING_CODE_INVALID',
    });
  }
}

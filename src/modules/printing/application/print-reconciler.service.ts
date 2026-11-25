import { Injectable, Logger } from '@nestjs/common';
import {
  PrintJobKind,
  PrintJobStatus,
  PrinterStatus,
  PrinterTransport,
  StationTicketStatus,
} from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { enqueueStationTicketPrintUnsafe } from './enqueue-station-ticket-print';
import { PrintAlertsService } from './print-alerts.service';
import { PrintingConfigService } from './printing-config.service';

const MISSING_WINDOW_MS = 24 * 60 * 60 * 1000;
const MISSING_BATCH = 50;
const MISSING_SCAN = MISSING_BATCH * 4;
const OFFLINE_ALERT_AFTER_MS = 2 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const DEVICE_TRANSPORTS: PrinterTransport[] = [
  PrinterTransport.APP_BRIDGE,
  PrinterTransport.BROWSER,
  PrinterTransport.AGENT,
];

export type ReconcileResult = {
  created: number;
  released: number;
  failedStuck: number;
  markedOffline: number;
  alerted: number;
  purged: number;
};

@Injectable()
export class PrintReconcilerService {
  private readonly logger = new Logger(PrintReconcilerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: PrintingConfigService,
    private readonly alerts: PrintAlertsService,
  ) {}

  async runOnce(now = new Date()): Promise<ReconcileResult> {
    const created = await this.createMissingJobs(now);
    const stuck = await this.releaseStuckClaims(now);
    const markedOffline = await this.markSilentDevicesOffline(now);
    const alerted = await this.alertOfflinePrinters(now);
    const purged = await this.purgeOld(now);

    return { created, ...stuck, markedOffline, alerted, purged };
  }

  async createMissingJobs(now: Date): Promise<number> {
    const candidates = await this.prisma.stationTicket.findMany({
      where: {
        createdAt: { gte: new Date(now.getTime() - MISSING_WINDOW_MS) },
        status: {
          in: [StationTicketStatus.PENDING, StationTicketStatus.IN_PROGRESS],
        },
        printJobs: { none: {} },
        preparationStation: {
          printers: { some: { printer: { active: true } } },
        },
      },
      select: {
        id: true,
        createdAt: true,
        preparationStation: {
          select: {
            printers: {
              where: { printer: { active: true } },
              select: {
                createdAt: true,
                printer: { select: { createdAt: true } },
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
      take: MISSING_SCAN,
    });
    const tickets = candidates
      .filter((ticket) =>
        ticket.preparationStation.printers.some(
          (link) =>
            Math.max(
              link.createdAt.getTime(),
              link.printer.createdAt.getTime(),
            ) <= ticket.createdAt.getTime(),
        ),
      )
      .slice(0, MISSING_BATCH);
    let created = 0;

    for (const ticket of tickets) {
      try {
        await this.prisma.$transaction((tx) =>
          enqueueStationTicketPrintUnsafe(tx, ticket.id),
        );
        created += 1;
      } catch (error) {
        this.logger.warn(
          `No se pudo completar la comanda ${ticket.id}: ${
            error instanceof Error ? error.message : 'error desconocido'
          }`,
        );
      }
    }

    return created;
  }

  async releaseStuckClaims(
    now: Date,
  ): Promise<{ released: number; failedStuck: number }> {
    const cutoff = new Date(
      now.getTime() - this.config.stuckClaimMinutes * 60_000,
    );
    const stuck = await this.prisma.printJob.findMany({
      where: {
        status: PrintJobStatus.CLAIMED,
        leaseUntil: { lt: cutoff },
        attempts: { gte: this.config.maxAttempts },
      },
      include: {
        printer: { select: { name: true } },
        branch: { select: { restaurantId: true } },
      },
    });
    let failedStuck = 0;

    for (const job of stuck) {
      const marked = await this.prisma.printJob.updateMany({
        where: {
          id: job.id,
          status: PrintJobStatus.CLAIMED,
          leaseUntil: { lt: cutoff },
        },
        data: {
          status: PrintJobStatus.FAILED,
          leaseUntil: null,
          lastError: '[LEASE_EXPIRED] Sin respuesta del dispositivo.',
        },
      });

      if (marked.count === 0) {
        continue;
      }

      failedStuck += 1;

      const number = (job.document as { header?: { number?: unknown } } | null)
        ?.header?.number;

      await this.alerts.jobFailed(
        {
          restaurantId: job.branch.restaurantId,
          branchId: job.branchId,
          entityType: 'PrintJob',
          entityId: job.id,
        },
        {
          printerName: job.printer.name,
          code: 'LEASE_EXPIRED',
          displayNumber: typeof number === 'string' ? number : undefined,
        },
      );
    }

    const released = await this.prisma.printJob.updateMany({
      where: {
        status: PrintJobStatus.CLAIMED,
        leaseUntil: { lt: cutoff },
        attempts: { lt: this.config.maxAttempts },
      },
      data: {
        status: PrintJobStatus.PENDING,
        leaseUntil: null,
        nextAttemptAt: now,
      },
    });

    return { released: released.count, failedStuck };
  }

  async markSilentDevicesOffline(now: Date): Promise<number> {
    const result = await this.prisma.printer.updateMany({
      where: {
        active: true,
        transport: { in: DEVICE_TRANSPORTS },
        status: { not: PrinterStatus.OFFLINE },
        lastSeenAt: {
          lt: new Date(now.getTime() - this.config.deviceOfflineSeconds * 1000),
        },
      },
      data: { status: PrinterStatus.OFFLINE },
    });

    return result.count;
  }

  async alertOfflinePrinters(now: Date): Promise<number> {
    const printers = await this.prisma.printer.findMany({
      where: {
        active: true,
        status: PrinterStatus.OFFLINE,
        OR: [
          { lastSeenAt: null },
          {
            lastSeenAt: {
              lt: new Date(now.getTime() - OFFLINE_ALERT_AFTER_MS),
            },
          },
        ],
      },
      include: { branch: { select: { restaurantId: true } } },
    });
    let alerted = 0;

    for (const printer of printers) {
      const sent = await this.alerts.printerOffline(
        {
          restaurantId: printer.branch.restaurantId,
          branchId: printer.branchId,
          entityType: 'Printer',
          entityId: printer.id,
        },
        { printerName: printer.name, lastError: printer.lastError },
      );

      if (sent) {
        alerted += 1;
      }
    }

    return alerted;
  }

  async purgeOld(now: Date): Promise<number> {
    const done = await this.prisma.printJob.deleteMany({
      where: {
        status: { in: [PrintJobStatus.PRINTED, PrintJobStatus.CANCELLED] },
        updatedAt: {
          lt: new Date(now.getTime() - this.config.doneRetentionDays * DAY_MS),
        },
      },
    });
    const failed = await this.prisma.printJob.deleteMany({
      where: {
        status: PrintJobStatus.FAILED,
        kind: {
          in: [PrintJobKind.COMANDA, PrintJobKind.VOID, PrintJobKind.TEST],
        },
        updatedAt: {
          lt: new Date(
            now.getTime() - this.config.failedRetentionDays * DAY_MS,
          ),
        },
      },
    });

    return done.count + failed.count;
  }
}

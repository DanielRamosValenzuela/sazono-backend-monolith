import { Injectable, Logger } from '@nestjs/common';
import { PrinterStatus, PrinterTransport } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { SimulatedTransport } from '../infrastructure/simulated.transport';
import { Tcp9100Transport } from '../infrastructure/tcp9100.transport';
import type {
  DeliverOutcome,
  PrintTransport,
} from './ports/print-transport.port';
import { PrintQueueService } from './print-queue.service';
import { PrintingConfigService } from './printing-config.service';
import { documentForDelivery, renderPrinterBytes } from './render-job';

export type PrintWorkerRunResult = {
  claimed: number;
  printed: number;
  failed: number;
};

const SERVER_CLAIMER = 'server';
const MAX_CONCURRENT_PRINTERS = 4;

type ClaimedItem = Awaited<ReturnType<PrintQueueService['claim']>>[number];

@Injectable()
export class PrintWorkerService {
  private readonly logger = new Logger(PrintWorkerService.name);
  private readonly transports: Map<PrinterTransport, PrintTransport>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: PrintQueueService,
    private readonly config: PrintingConfigService,
    simulated: SimulatedTransport,
    tcp: Tcp9100Transport,
  ) {
    this.transports = new Map<PrinterTransport, PrintTransport>([
      [simulated.kind, simulated],
      [tcp.kind, tcp],
    ]);
  }

  serverTransports(): PrinterTransport[] {
    return this.config.tcpEnabled
      ? [PrinterTransport.SIMULATED, PrinterTransport.TCP]
      : [PrinterTransport.SIMULATED];
  }

  async runOnce(): Promise<PrintWorkerRunResult> {
    const claimed = await this.queue.claim({
      transports: this.serverTransports(),
      limit: this.config.batchSize,
      leaseSeconds: this.config.serverLeaseSeconds,
      claimedBy: SERVER_CLAIMER,
    });
    let printed = 0;
    let failed = 0;
    const lanes = new Map<string, ClaimedItem[]>();

    for (const item of claimed) {
      lanes.set(item.printer.id, [...(lanes.get(item.printer.id) ?? []), item]);
    }

    const waiting = [...lanes.values()];
    const runLanes = async (): Promise<void> => {
      for (let lane = waiting.shift(); lane; lane = waiting.shift()) {
        for (const item of lane) {
          if (await this.processGuarded(item)) {
            printed += 1;
          } else {
            failed += 1;
          }
        }
      }
    };

    await Promise.all(
      Array.from(
        { length: Math.min(MAX_CONCURRENT_PRINTERS, waiting.length) },
        runLanes,
      ),
    );

    return { claimed: claimed.length, printed, failed };
  }

  private processGuarded(item: ClaimedItem): Promise<boolean> {
    return this.processOne(item).catch(async (error: unknown) => {
      const message =
        error instanceof Error ? error.message : 'error desconocido';

      this.logger.error(
        `Fallo procesando el trabajo ${item.job.id}: ${message}`,
      );
      await this.queue.fail(item.job.id, {
        code: 'INTERNAL_ERROR',
        message,
        retryable: true,
      });

      return false;
    });
  }

  private async processOne(item: ClaimedItem): Promise<boolean> {
    const { job, printer, retryUncertain } = item;
    const transport = this.transports.get(printer.transport);
    const doc = documentForDelivery(job, {
      now: new Date(),
      attempts: job.attempts,
      retryUncertain,
      lateMinutes: this.config.lateMinutes,
    });

    if (!transport || !doc) {
      await this.queue.fail(job.id, {
        code: transport ? 'INVALID_DOCUMENT' : 'NO_TRANSPORT',
        message: 'El trabajo no se puede entregar.',
        retryable: false,
      });
      return false;
    }

    const bytes = renderPrinterBytes(doc, printer);
    const renewed = await this.queue.extend(
      job.id,
      undefined,
      this.config.serverLeaseSeconds,
    );

    if (!renewed) {
      return false;
    }

    const abort = new AbortController();
    const outcome: DeliverOutcome = await transport.deliver(
      printer,
      bytes,
      abort.signal,
    );

    if (outcome.kind === 'OK') {
      await this.queue.ack(job.id);
      await this.touchPrinter(printer.id, PrinterStatus.ONLINE, null);
      return true;
    }

    await this.queue.fail(job.id, outcome);
    await this.touchPrinter(
      printer.id,
      PrinterStatus.OFFLINE,
      `[${outcome.code}] ${outcome.message}`.slice(0, 500),
    );

    return false;
  }

  private async touchPrinter(
    printerId: string,
    status: PrinterStatus,
    lastError: string | null,
  ): Promise<void> {
    await this.prisma.printer.update({
      where: { id: printerId },
      data: {
        status,
        lastError,
        ...(status === PrinterStatus.ONLINE ? { lastSeenAt: new Date() } : {}),
      },
    });
  }
}

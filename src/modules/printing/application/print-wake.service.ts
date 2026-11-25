import { EventEmitter } from 'node:events';
import { Injectable, Logger } from '@nestjs/common';
import { PrintJobStatus, PrinterTransport, Role } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { PushNotificationService } from '../../notifications/application/push-notification.service';
import { PrintingConfigService } from './printing-config.service';

const DEVICE_TRANSPORTS: PrinterTransport[] = [
  PrinterTransport.APP_BRIDGE,
  PrinterTransport.BROWSER,
  PrinterTransport.AGENT,
];
const SCAN_WINDOW_MS = 5 * 60 * 1000;
const KEEP_NOTIFIED_MS = 15 * 60 * 1000;
const PUSH_MIN_GAP_MS = 3000;

@Injectable()
export class PrintWakeService {
  private readonly logger = new Logger(PrintWakeService.name);
  private readonly emitter = new EventEmitter();
  private readonly notified = new Map<string, number>();
  private readonly lastPush = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly push: PushNotificationService,
    private readonly config: PrintingConfigService,
  ) {
    this.emitter.setMaxListeners(0);
  }

  notifyBranch(branchId: string): void {
    this.emitter.emit(branchId);
    void this.sendPush(branchId);
  }

  waitFor(
    branchId: string,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<void> {
    return new Promise((resolve) => {
      const finish = () => {
        clearTimeout(timer);
        this.emitter.off(branchId, finish);
        signal?.removeEventListener('abort', finish);
        resolve();
      };
      const timer = setTimeout(finish, Math.max(timeoutMs, 0));

      this.emitter.once(branchId, finish);
      signal?.addEventListener('abort', finish, { once: true });
    });
  }

  async scan(now = new Date()): Promise<number> {
    const jobs = await this.prisma.printJob.findMany({
      where: {
        status: PrintJobStatus.PENDING,
        updatedAt: { gte: new Date(now.getTime() - SCAN_WINDOW_MS) },
        nextAttemptAt: { lte: now },
        printer: { active: true, transport: { in: DEVICE_TRANSPORTS } },
      },
      select: { id: true, branchId: true, nextAttemptAt: true },
    });
    const branches = new Set<string>();

    for (const job of jobs) {
      const key = `${job.id}:${job.nextAttemptAt.getTime()}`;

      if (!this.notified.has(key)) {
        this.notified.set(key, now.getTime());
        branches.add(job.branchId);
      }
    }

    for (const [key, at] of this.notified) {
      if (now.getTime() - at > KEEP_NOTIFIED_MS) {
        this.notified.delete(key);
      }
    }

    for (const branchId of branches) {
      this.notifyBranch(branchId);
    }

    return branches.size;
  }

  private async sendPush(branchId: string): Promise<void> {
    if (!this.config.wakePushEnabled) {
      return;
    }

    const last = this.lastPush.get(branchId) ?? 0;

    if (Date.now() - last < PUSH_MIN_GAP_MS) {
      return;
    }

    this.lastPush.set(branchId, Date.now());

    try {
      await this.push.sendDataToBranchRoles(
        branchId,
        [Role.KITCHEN, Role.BAR],
        { type: 'PRINT_WAKE', branchId },
      );
    } catch (error) {
      this.logger.warn(
        `No se pudo enviar el push de despertar: ${
          error instanceof Error ? error.message : 'error desconocido'
        }`,
      );
    }
  }
}

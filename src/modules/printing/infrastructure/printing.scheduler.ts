import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { PrintReconcilerService } from '../application/print-reconciler.service';
import { PrintWakeService } from '../application/print-wake.service';
import { PrintWorkerService } from '../application/print-worker.service';
import { PrintingConfigService } from '../application/printing-config.service';

export const PRINTING_WORKER_JOB_NAME = 'printing-worker';
export const PRINTING_RECONCILER_JOB_NAME = 'printing-reconciler';

@Injectable()
export class PrintingScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrintingScheduler.name);
  private workerRunning = false;
  private reconcilerRunning = false;

  constructor(
    private readonly schedulerRegistry: SchedulerRegistry,
    private readonly worker: PrintWorkerService,
    private readonly reconciler: PrintReconcilerService,
    private readonly config: PrintingConfigService,
    private readonly wake: PrintWakeService,
  ) {}

  onModuleInit(): void {
    if (!this.config.workerEnabled) {
      return;
    }

    this.schedulerRegistry.addInterval(
      PRINTING_WORKER_JOB_NAME,
      setInterval(() => {
        void this.tick();
      }, this.config.intervalMs),
    );
    this.schedulerRegistry.addInterval(
      PRINTING_RECONCILER_JOB_NAME,
      setInterval(() => {
        void this.reconcile();
      }, this.config.reconcileIntervalMs),
    );
    this.logger.log(
      `Worker de impresion cada ${this.config.intervalMs} ms y reconciliador cada ${this.config.reconcileIntervalMs} ms.`,
    );
  }

  onModuleDestroy(): void {
    for (const name of [
      PRINTING_WORKER_JOB_NAME,
      PRINTING_RECONCILER_JOB_NAME,
    ]) {
      if (this.schedulerRegistry.doesExist('interval', name)) {
        this.schedulerRegistry.deleteInterval(name);
      }
    }
  }

  async tick(): Promise<void> {
    if (this.workerRunning) {
      return;
    }

    this.workerRunning = true;

    try {
      await this.worker.runOnce();
      await this.wake.scan();
    } catch (error) {
      this.logger.error(
        `El worker de impresion fallo: ${
          error instanceof Error ? error.message : 'error desconocido'
        }`,
      );
    } finally {
      this.workerRunning = false;
    }
  }

  async reconcile(): Promise<void> {
    if (this.reconcilerRunning) {
      return;
    }

    this.reconcilerRunning = true;

    try {
      await this.reconciler.runOnce();
    } catch (error) {
      this.logger.error(
        `El reconciliador de impresion fallo: ${
          error instanceof Error ? error.message : 'error desconocido'
        }`,
      );
    } finally {
      this.reconcilerRunning = false;
    }
  }
}

import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { TaxDocumentWorkerService } from '../application/tax-document-worker.service';
import { TaxDocumentsConfigService } from '../application/tax-documents-config.service';

export const TAX_DOCUMENTS_JOB_NAME = 'tax-documents-worker';

@Injectable()
export class TaxDocumentsScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TaxDocumentsScheduler.name);
  private running = false;

  constructor(
    private readonly schedulerRegistry: SchedulerRegistry,
    private readonly worker: TaxDocumentWorkerService,
    private readonly config: TaxDocumentsConfigService,
  ) {}

  onModuleInit(): void {
    if (!this.config.workerEnabled) {
      return;
    }

    const interval = setInterval(() => {
      void this.tick();
    }, this.config.intervalMs);
    this.schedulerRegistry.addInterval(TAX_DOCUMENTS_JOB_NAME, interval);
    this.logger.log(
      `Worker de documentos tributarios programado cada ${this.config.intervalMs} ms (lote ${this.config.batchSize}).`,
    );
  }

  onModuleDestroy(): void {
    if (this.schedulerRegistry.doesExist('interval', TAX_DOCUMENTS_JOB_NAME)) {
      this.schedulerRegistry.deleteInterval(TAX_DOCUMENTS_JOB_NAME);
    }
  }

  async tick(): Promise<void> {
    if (this.running) {
      return;
    }

    this.running = true;

    try {
      await this.worker.runOnce();
    } catch (error) {
      this.logger.error(
        `El worker de documentos tributarios fallo: ${
          error instanceof Error ? error.message : 'error desconocido'
        }`,
      );
    } finally {
      this.running = false;
    }
  }
}

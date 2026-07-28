import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { ReconcileTransbankPaymentsService } from '../../application/reconcile-transbank-payments.service';
import { TransbankConfigService } from './transbank-config.service';

const RECONCILIATION_JOB_NAME = 'transbank-payment-reconciliation';

@Injectable()
export class ReconcileTransbankPaymentsScheduler
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(
    ReconcileTransbankPaymentsScheduler.name,
  );

  constructor(
    private readonly schedulerRegistry: SchedulerRegistry,
    private readonly reconcileTransbankPaymentsService: ReconcileTransbankPaymentsService,
    private readonly transbankConfig: TransbankConfigService,
  ) {}

  onModuleInit(): void {
    if (!this.transbankConfig.isEnabled) {
      return;
    }

    const intervalMs = this.transbankConfig.reconciliationIntervalMs;
    const interval = setInterval(() => {
      void this.runReconciliation();
    }, intervalMs);
    this.schedulerRegistry.addInterval(RECONCILIATION_JOB_NAME, interval);
    this.logger.log(
      `Job de conciliacion Transbank programado cada ${intervalMs} ms (umbral ${this.transbankConfig.reconciliationMinAgeMinutes} min).`,
    );
  }

  onModuleDestroy(): void {
    if (this.schedulerRegistry.doesExist('interval', RECONCILIATION_JOB_NAME)) {
      this.schedulerRegistry.deleteInterval(RECONCILIATION_JOB_NAME);
    }
  }

  private async runReconciliation(): Promise<void> {
    try {
      await this.reconcileTransbankPaymentsService.execute(
        this.transbankConfig.reconciliationMinAgeMinutes,
      );
    } catch (error) {
      this.logger.error(
        `El job de conciliacion Transbank fallo: ${
          error instanceof Error ? error.message : 'error desconocido'
        }`,
      );
    }
  }
}

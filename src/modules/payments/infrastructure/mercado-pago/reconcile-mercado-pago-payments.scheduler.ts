import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { ReconcileMercadoPagoPaymentsService } from '../../application/reconcile-mercado-pago-payments.service';
import { MercadoPagoConfigService } from './mercado-pago-config.service';

const RECONCILIATION_JOB_NAME = 'mercadopago-payment-reconciliation';

@Injectable()
export class ReconcileMercadoPagoPaymentsScheduler
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(
    ReconcileMercadoPagoPaymentsScheduler.name,
  );

  constructor(
    private readonly schedulerRegistry: SchedulerRegistry,
    private readonly reconcileMercadoPagoPaymentsService: ReconcileMercadoPagoPaymentsService,
    private readonly mercadoPagoConfig: MercadoPagoConfigService,
  ) {}

  onModuleInit(): void {
    if (
      !this.mercadoPagoConfig.isEnabled ||
      this.mercadoPagoConfig.apiMode !== 'orders'
    ) {
      return;
    }

    const intervalMs = this.mercadoPagoConfig.reconciliationIntervalMs;
    const interval = setInterval(() => {
      void this.runReconciliation();
    }, intervalMs);
    this.schedulerRegistry.addInterval(RECONCILIATION_JOB_NAME, interval);
    this.logger.log(
      `Job de conciliacion Mercado Pago programado cada ${intervalMs} ms (umbral ${this.mercadoPagoConfig.reconciliationMinAgeMinutes} min).`,
    );
  }

  onModuleDestroy(): void {
    if (this.schedulerRegistry.doesExist('interval', RECONCILIATION_JOB_NAME)) {
      this.schedulerRegistry.deleteInterval(RECONCILIATION_JOB_NAME);
    }
  }

  private async runReconciliation(): Promise<void> {
    try {
      await this.reconcileMercadoPagoPaymentsService.execute(
        this.mercadoPagoConfig.reconciliationMinAgeMinutes,
      );
    } catch (error) {
      this.logger.error(
        `El job de conciliacion Mercado Pago fallo: ${
          error instanceof Error ? error.message : 'error desconocido'
        }`,
      );
    }
  }
}

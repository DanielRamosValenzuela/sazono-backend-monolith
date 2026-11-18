import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { ReconcileGatewayRefundsService } from '../application/reconcile-gateway-refunds.service';

const JOB_NAME = 'gateway-refund-reconciliation';
const DEFAULT_INTERVAL_MS = 2 * 60 * 1000;
const DEFAULT_MIN_AGE_MINUTES = 2;
const DEFAULT_MAX_ATTEMPTS = 10;
const DEFAULT_MAX_AGE_HOURS = 48;

@Injectable()
export class ReconcileGatewayRefundsScheduler
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(ReconcileGatewayRefundsScheduler.name);

  constructor(
    private readonly schedulerRegistry: SchedulerRegistry,
    private readonly reconcileGatewayRefundsService: ReconcileGatewayRefundsService,
    private readonly configService: ConfigService,
  ) {}

  onModuleInit(): void {
    const enabled =
      this.configService.get<boolean>('REFUND_RECONCILIATION_ENABLED') ?? true;

    if (!enabled || this.configService.get<string>('NODE_ENV') === 'test') {
      return;
    }

    const intervalMs = this.number(
      'REFUND_RECONCILIATION_INTERVAL_MS',
      DEFAULT_INTERVAL_MS,
    );
    const interval = setInterval(() => {
      void this.run();
    }, intervalMs);
    this.schedulerRegistry.addInterval(JOB_NAME, interval);
    this.logger.log(
      `Job de conciliacion de reembolsos programado cada ${intervalMs} ms.`,
    );
  }

  onModuleDestroy(): void {
    if (this.schedulerRegistry.doesExist('interval', JOB_NAME)) {
      this.schedulerRegistry.deleteInterval(JOB_NAME);
    }
  }

  private number(name: string, fallback: number): number {
    return this.configService.get<number>(name) ?? fallback;
  }

  private async run(): Promise<void> {
    try {
      await this.reconcileGatewayRefundsService.execute({
        minAgeMinutes: this.number(
          'REFUND_RECONCILIATION_MIN_AGE_MINUTES',
          DEFAULT_MIN_AGE_MINUTES,
        ),
        maxAttempts: this.number(
          'REFUND_RECONCILIATION_MAX_ATTEMPTS',
          DEFAULT_MAX_ATTEMPTS,
        ),
        maxAgeHours: this.number(
          'REFUND_RECONCILIATION_MAX_AGE_HOURS',
          DEFAULT_MAX_AGE_HOURS,
        ),
      });
    } catch (error) {
      this.logger.error(
        `El job de conciliacion de reembolsos fallo: ${
          error instanceof Error ? error.message : 'error desconocido'
        }`,
      );
    }
  }
}

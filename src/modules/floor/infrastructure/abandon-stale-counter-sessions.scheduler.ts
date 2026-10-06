import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { AbandonStaleCounterSessionsService } from '../application/abandon-stale-counter-sessions.service';
import { COUNTER_STALE_SWEEP_INTERVAL_MS } from '../domain/counter-table';

const STALE_COUNTER_JOB_NAME = 'stale-counter-sessions-abandon';

@Injectable()
export class AbandonStaleCounterSessionsScheduler
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(
    AbandonStaleCounterSessionsScheduler.name,
  );

  constructor(
    private readonly schedulerRegistry: SchedulerRegistry,
    private readonly abandonStaleCounterSessionsService: AbandonStaleCounterSessionsService,
  ) {}

  onModuleInit(): void {
    const interval = setInterval(() => {
      void this.run();
    }, COUNTER_STALE_SWEEP_INTERVAL_MS);
    this.schedulerRegistry.addInterval(STALE_COUNTER_JOB_NAME, interval);
  }

  onModuleDestroy(): void {
    if (this.schedulerRegistry.doesExist('interval', STALE_COUNTER_JOB_NAME)) {
      this.schedulerRegistry.deleteInterval(STALE_COUNTER_JOB_NAME);
    }
  }

  private async run(): Promise<void> {
    try {
      const abandoned = await this.abandonStaleCounterSessionsService.execute();

      if (abandoned > 0) {
        this.logger.log(
          `Se abandonaron ${abandoned} pedidos de mesa virtual vencidos.`,
        );
      }
    } catch (error) {
      this.logger.error(
        `El job de pedidos de mesa virtual vencidos fallo: ${
          error instanceof Error ? error.message : 'error desconocido'
        }`,
      );
    }
  }
}

import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import {
  DEFAULT_RESTAURANT_TIMEZONE,
  zonedDateKey,
} from '../../../common/time/restaurant-time';
import { PlatformStatementsService } from '../application/platform-statements.service';
import { shiftPeriod } from '../domain/fee-calculation';

const JOB_NAME = 'platform-fee-monthly-drafts';
const CHECK_INTERVAL_MS = 15 * 60 * 1000;
const RUN_HOUR = 3;

function localHour(now: Date): number {
  return Number(
    new Intl.DateTimeFormat('en-US', {
      timeZone: DEFAULT_RESTAURANT_TIMEZONE,
      hourCycle: 'h23',
      hour: '2-digit',
    }).format(now),
  );
}

export function isDraftRunDue(
  now: Date,
  lastRunPeriod: string | null,
): { due: boolean; period: string } {
  const dateKey = zonedDateKey(now, DEFAULT_RESTAURANT_TIMEZONE);
  const previous = shiftPeriod(dateKey.slice(0, 7), -1);

  return {
    due:
      dateKey.endsWith('-01') &&
      localHour(now) >= RUN_HOUR &&
      lastRunPeriod !== previous,
    period: previous,
  };
}

@Injectable()
export class PlatformStatementsScheduler
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PlatformStatementsScheduler.name);
  private lastRunPeriod: string | null = null;

  constructor(
    private readonly schedulerRegistry: SchedulerRegistry,
    private readonly statements: PlatformStatementsService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    if (
      this.config.get<string>('NODE_ENV') === 'test' ||
      this.config.get<boolean>('PLATFORM_FEE_SCHEDULER_ENABLED') === false
    ) {
      return;
    }

    const interval = setInterval(() => {
      void this.tick();
    }, CHECK_INTERVAL_MS);
    this.schedulerRegistry.addInterval(JOB_NAME, interval);
    this.logger.log(
      'Job de borradores mensuales de comision programado (dia 1, 03:00 America/Santiago).',
    );
  }

  onModuleDestroy(): void {
    if (this.schedulerRegistry.doesExist('interval', JOB_NAME)) {
      this.schedulerRegistry.deleteInterval(JOB_NAME);
    }
  }

  async tick(now = new Date()): Promise<void> {
    const { due, period } = isDraftRunDue(now, this.lastRunPeriod);

    if (!due) {
      return;
    }

    try {
      const created = await this.statements.createDrafts(period);
      this.lastRunPeriod = period;
      this.logger.log(`Borradores de comision ${period}: ${created} creados.`);
    } catch (error) {
      this.logger.error(
        `El job de borradores de comision fallo: ${
          error instanceof Error ? error.message : 'error desconocido'
        }`,
      );
    }
  }
}

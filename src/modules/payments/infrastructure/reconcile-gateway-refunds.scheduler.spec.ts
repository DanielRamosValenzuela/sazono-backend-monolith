import type { ConfigService } from '@nestjs/config';
import type { SchedulerRegistry } from '@nestjs/schedule';
import type { ReconcileGatewayRefundsService } from '../application/reconcile-gateway-refunds.service';
import { ReconcileGatewayRefundsScheduler } from './reconcile-gateway-refunds.scheduler';

describe('ReconcileGatewayRefundsScheduler', () => {
  const addInterval = jest.fn();
  const execute = jest.fn().mockResolvedValue(undefined);

  const build = (config: Record<string, unknown>) =>
    new ReconcileGatewayRefundsScheduler(
      {
        addInterval,
        deleteInterval: jest.fn(),
        doesExist: jest.fn(),
      } as unknown as SchedulerRegistry,
      { execute } as unknown as ReconcileGatewayRefundsService,
      { get: (name: string) => config[name] } as unknown as ConfigService,
    );

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('is disabled under NODE_ENV=test', () => {
    build({ NODE_ENV: 'test' }).onModuleInit();

    expect(addInterval).not.toHaveBeenCalled();
  });

  it('is disabled when REFUND_RECONCILIATION_ENABLED is false', () => {
    build({ REFUND_RECONCILIATION_ENABLED: false }).onModuleInit();

    expect(addInterval).not.toHaveBeenCalled();
  });

  it('runs periodically with the defaults', async () => {
    build({ NODE_ENV: 'production' }).onModuleInit();

    expect(addInterval).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(2 * 60 * 1000);
    expect(execute).toHaveBeenCalledWith({
      minAgeMinutes: 2,
      maxAttempts: 10,
      maxAgeHours: 48,
    });
  });
});

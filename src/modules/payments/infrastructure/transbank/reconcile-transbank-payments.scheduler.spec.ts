import type { SchedulerRegistry } from '@nestjs/schedule';
import type { ReconcileTransbankPaymentsService } from '../../application/reconcile-transbank-payments.service';
import { ReconcileTransbankPaymentsScheduler } from './reconcile-transbank-payments.scheduler';
import type { TransbankConfigService } from './transbank-config.service';

describe('ReconcileTransbankPaymentsScheduler', () => {
  const addIntervalMock = jest.fn();
  const deleteIntervalMock = jest.fn();
  const doesExistMock = jest.fn();
  const schedulerRegistry = {
    addInterval: addIntervalMock,
    deleteInterval: deleteIntervalMock,
    doesExist: doesExistMock,
  } as unknown as SchedulerRegistry;

  const executeMock = jest.fn().mockResolvedValue(undefined);
  const reconcileTransbankPaymentsService = {
    execute: executeMock,
  } as unknown as ReconcileTransbankPaymentsService;

  let transbankConfig: TransbankConfigService;
  let scheduler: ReconcileTransbankPaymentsScheduler;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    transbankConfig = {
      isEnabled: true,
      reconciliationIntervalMs: 60000,
      reconciliationMinAgeMinutes: 10,
    } as unknown as TransbankConfigService;
    scheduler = new ReconcileTransbankPaymentsScheduler(
      schedulerRegistry,
      reconcileTransbankPaymentsService,
      transbankConfig,
    );
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('does not register any interval when TRANSBANK_ENABLED is false', () => {
    transbankConfig = {
      isEnabled: false,
      reconciliationIntervalMs: 60000,
      reconciliationMinAgeMinutes: 10,
    } as unknown as TransbankConfigService;
    scheduler = new ReconcileTransbankPaymentsScheduler(
      schedulerRegistry,
      reconcileTransbankPaymentsService,
      transbankConfig,
    );

    scheduler.onModuleInit();

    expect(addIntervalMock).not.toHaveBeenCalled();
  });

  it('registers a periodic interval that reconciles with the configured minimum age when TRANSBANK_ENABLED is true', async () => {
    scheduler.onModuleInit();

    expect(addIntervalMock).toHaveBeenCalledWith(
      'transbank-payment-reconciliation',
      expect.anything(),
    );

    await jest.advanceTimersByTimeAsync(60000);

    expect(executeMock).toHaveBeenCalledWith(10);
  });

  it('swallows errors thrown by the reconciliation service so the interval keeps running', async () => {
    executeMock.mockRejectedValueOnce(new Error('DB no disponible'));
    scheduler.onModuleInit();

    await jest.advanceTimersByTimeAsync(60000);
    await jest.advanceTimersByTimeAsync(60000);

    expect(executeMock).toHaveBeenCalledTimes(2);
  });

  it('clears the registered interval on destroy when it exists', () => {
    doesExistMock.mockReturnValue(true);

    scheduler.onModuleDestroy();

    expect(deleteIntervalMock).toHaveBeenCalledWith(
      'transbank-payment-reconciliation',
    );
  });

  it('does not try to clear an interval that was never registered', () => {
    doesExistMock.mockReturnValue(false);

    scheduler.onModuleDestroy();

    expect(deleteIntervalMock).not.toHaveBeenCalled();
  });
});

import type { SchedulerRegistry } from '@nestjs/schedule';
import type { ReconcileMercadoPagoPaymentsService } from '../../application/reconcile-mercado-pago-payments.service';
import type { MercadoPagoConfigService } from './mercado-pago-config.service';
import { ReconcileMercadoPagoPaymentsScheduler } from './reconcile-mercado-pago-payments.scheduler';

describe('ReconcileMercadoPagoPaymentsScheduler', () => {
  const addIntervalMock = jest.fn();
  const deleteIntervalMock = jest.fn();
  const doesExistMock = jest.fn();
  const schedulerRegistry = {
    addInterval: addIntervalMock,
    deleteInterval: deleteIntervalMock,
    doesExist: doesExistMock,
  } as unknown as SchedulerRegistry;

  const executeMock = jest.fn().mockResolvedValue(undefined);
  const reconcileService = {
    execute: executeMock,
  } as unknown as ReconcileMercadoPagoPaymentsService;

  const build = (overrides: Record<string, unknown>) =>
    new ReconcileMercadoPagoPaymentsScheduler(
      schedulerRegistry,
      reconcileService,
      {
        isEnabled: true,
        apiMode: 'orders',
        reconciliationIntervalMs: 60000,
        reconciliationMinAgeMinutes: 5,
        ...overrides,
      } as unknown as MercadoPagoConfigService,
    );

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('registers nothing in payments mode', () => {
    build({ apiMode: 'payments' }).onModuleInit();

    expect(addIntervalMock).not.toHaveBeenCalled();
  });

  it('registers nothing when Mercado Pago is disabled', () => {
    build({ isEnabled: false }).onModuleInit();

    expect(addIntervalMock).not.toHaveBeenCalled();
  });

  it('runs the reconciliation periodically with the configured minimum age in orders mode', async () => {
    const scheduler = build({});
    scheduler.onModuleInit();

    expect(addIntervalMock).toHaveBeenCalledWith(
      'mercadopago-payment-reconciliation',
      expect.anything(),
    );

    await jest.advanceTimersByTimeAsync(60000);

    expect(executeMock).toHaveBeenCalledWith(5);

    doesExistMock.mockReturnValue(true);
    scheduler.onModuleDestroy();
    expect(deleteIntervalMock).toHaveBeenCalledWith(
      'mercadopago-payment-reconciliation',
    );
  });
});

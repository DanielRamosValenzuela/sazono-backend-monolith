import type { SchedulerRegistry } from '@nestjs/schedule';
import type { AbandonStaleCounterSessionsService } from '../application/abandon-stale-counter-sessions.service';
import { COUNTER_STALE_SWEEP_INTERVAL_MS } from '../domain/counter-table';
import { AbandonStaleCounterSessionsScheduler } from './abandon-stale-counter-sessions.scheduler';

describe('AbandonStaleCounterSessionsScheduler', () => {
  const addIntervalMock = jest.fn();
  const deleteIntervalMock = jest.fn();
  const doesExistMock = jest.fn();
  const executeMock = jest.fn();
  const scheduler = new AbandonStaleCounterSessionsScheduler(
    {
      addInterval: addIntervalMock,
      deleteInterval: deleteIntervalMock,
      doesExist: doesExistMock,
    } as unknown as SchedulerRegistry,
    { execute: executeMock } as unknown as AbandonStaleCounterSessionsService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => jest.useRealTimers());

  it('registers an interval that sweeps and survives errors', async () => {
    executeMock.mockRejectedValueOnce(new Error('db down'));
    executeMock.mockResolvedValue(0);
    scheduler.onModuleInit();

    expect(addIntervalMock).toHaveBeenCalledWith(
      'stale-counter-sessions-abandon',
      expect.anything(),
    );

    await jest.advanceTimersByTimeAsync(COUNTER_STALE_SWEEP_INTERVAL_MS * 2);

    expect(executeMock).toHaveBeenCalledTimes(2);
    clearInterval(addIntervalMock.mock.calls[0][1] as NodeJS.Timeout);
  });

  it('removes the interval on destroy only when registered', () => {
    doesExistMock.mockReturnValue(true);
    scheduler.onModuleDestroy();
    expect(deleteIntervalMock).toHaveBeenCalledWith(
      'stale-counter-sessions-abandon',
    );

    deleteIntervalMock.mockClear();
    doesExistMock.mockReturnValue(false);
    scheduler.onModuleDestroy();
    expect(deleteIntervalMock).not.toHaveBeenCalled();
  });
});

import { SchedulerRegistry } from '@nestjs/schedule';
import type { TaxDocumentWorkerService } from '../application/tax-document-worker.service';
import type { TaxDocumentsConfigService } from '../application/tax-documents-config.service';
import {
  TAX_DOCUMENTS_JOB_NAME,
  TaxDocumentsScheduler,
} from './tax-documents.scheduler';

function build(enabled: boolean, runOnce = jest.fn().mockResolvedValue({})) {
  const registry = new SchedulerRegistry();
  const scheduler = new TaxDocumentsScheduler(
    registry,
    { runOnce } as unknown as TaxDocumentWorkerService,
    {
      workerEnabled: enabled,
      intervalMs: 60_000,
      batchSize: 10,
    } as unknown as TaxDocumentsConfigService,
  );

  return { registry, scheduler, runOnce };
}

describe('TaxDocumentsScheduler', () => {
  it('registers nothing when the worker is disabled', () => {
    const { registry, scheduler } = build(false);

    scheduler.onModuleInit();

    expect(registry.doesExist('interval', TAX_DOCUMENTS_JOB_NAME)).toBe(false);
  });

  it('registers the interval when enabled and removes it on destroy', () => {
    const { registry, scheduler } = build(true);

    scheduler.onModuleInit();
    expect(registry.doesExist('interval', TAX_DOCUMENTS_JOB_NAME)).toBe(true);

    scheduler.onModuleDestroy();
    expect(registry.doesExist('interval', TAX_DOCUMENTS_JOB_NAME)).toBe(false);
  });

  it('does not overlap two ticks and survives worker errors', async () => {
    let release: () => void = () => undefined;
    const runOnce = jest.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const { scheduler } = build(true, runOnce);

    const first = scheduler.tick();
    await scheduler.tick();
    expect(runOnce).toHaveBeenCalledTimes(1);
    release();
    await first;

    runOnce.mockRejectedValueOnce(new Error('boom'));
    runOnce.mockResolvedValueOnce(undefined);
    await expect(scheduler.tick()).resolves.toBeUndefined();
    await expect(scheduler.tick()).resolves.toBeUndefined();
    expect(runOnce).toHaveBeenCalledTimes(3);
  });
});

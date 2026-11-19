import type { ConfigService } from '@nestjs/config';
import { TaxDocumentsConfigService } from './tax-documents-config.service';

const build = (values: Record<string, unknown>) =>
  new TaxDocumentsConfigService({
    get: (key: string) => values[key],
  } as unknown as ConfigService);

describe('TaxDocumentsConfigService', () => {
  it('is always disabled with NODE_ENV=test', () => {
    expect(
      build({ NODE_ENV: 'test', TAX_DOCUMENTS_WORKER_ENABLED: true })
        .workerEnabled,
    ).toBe(false);
    expect(
      build({ NODE_ENV: 'production', TAX_DOCUMENTS_WORKER_ENABLED: true })
        .workerEnabled,
    ).toBe(true);
    expect(
      build({ NODE_ENV: 'production', TAX_DOCUMENTS_WORKER_ENABLED: false })
        .workerEnabled,
    ).toBe(false);
  });

  it('reads the base urls per environment without a trailing slash', () => {
    const config = build({
      OPENFACTURA_SANDBOX_BASE_URL: 'https://sandbox.test/',
      OPENFACTURA_PRODUCTION_BASE_URL: 'https://prod.test',
    });

    expect(config.baseUrl('SANDBOX')).toBe('https://sandbox.test');
    expect(config.baseUrl('PRODUCTION')).toBe('https://prod.test');
  });

  it('falls back to the haulmer hosts and sane defaults', () => {
    const config = build({});

    expect(config.baseUrl('SANDBOX')).toBe('https://dev-api.haulmer.com');
    expect(config.baseUrl('PRODUCTION')).toBe('https://api.haulmer.com');
    expect(config.maxAttempts).toBe(8);
    expect(config.retryBaseMs).toBe(30_000);
    expect(config.batchSize).toBe(10);
  });
});

import { validateEnvironment } from './validate-environment';

describe('validateEnvironment for tax documents', () => {
  it('applies the OpenFactura defaults', () => {
    const config = validateEnvironment({});

    expect(config.OPENFACTURA_SANDBOX_BASE_URL).toBe(
      'https://dev-api.haulmer.com',
    );
    expect(config.OPENFACTURA_PRODUCTION_BASE_URL).toBe(
      'https://api.haulmer.com',
    );
    expect(config.TAX_DOCUMENTS_WORKER_ENABLED).toBe(true);
    expect(config.TAX_DOCUMENTS_MAX_ATTEMPTS).toBe(8);
  });

  it('accepts overrides and parses numbers', () => {
    const config = validateEnvironment({
      OPENFACTURA_SANDBOX_BASE_URL: 'http://localhost:4010',
      TAX_DOCUMENTS_WORKER_INTERVAL_MS: '5000',
      TAX_DOCUMENTS_WORKER_ENABLED: 'false',
    });

    expect(config.OPENFACTURA_SANDBOX_BASE_URL).toBe('http://localhost:4010');
    expect(config.TAX_DOCUMENTS_WORKER_INTERVAL_MS).toBe(5000);
    expect(config.TAX_DOCUMENTS_WORKER_ENABLED).toBe(false);
  });

  it('rejects an invalid base url and an out of range batch', () => {
    expect(() =>
      validateEnvironment({ OPENFACTURA_PRODUCTION_BASE_URL: 'not a url' }),
    ).toThrow();
    expect(() =>
      validateEnvironment({ TAX_DOCUMENTS_WORKER_BATCH_SIZE: '500' }),
    ).toThrow();
    expect(() =>
      validateEnvironment({ TAX_DOCUMENTS_WORKER_INTERVAL_MS: '10' }),
    ).toThrow();
  });
});

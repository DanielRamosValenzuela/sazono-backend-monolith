import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { TaxProviderEnvironmentName } from './ports/tax-document-provider.port';

const DEFAULT_SANDBOX_BASE_URL = 'https://dev-api.haulmer.com';
const DEFAULT_PRODUCTION_BASE_URL = 'https://api.haulmer.com';
const LEASE_SECONDS = 120;

@Injectable()
export class TaxDocumentsConfigService {
  constructor(private readonly config: ConfigService) {}

  get workerEnabled(): boolean {
    if (this.config.get<string>('NODE_ENV') === 'test') {
      return false;
    }

    return this.config.get<boolean>('TAX_DOCUMENTS_WORKER_ENABLED') ?? true;
  }

  get intervalMs(): number {
    return this.config.get<number>('TAX_DOCUMENTS_WORKER_INTERVAL_MS') ?? 15000;
  }

  get batchSize(): number {
    return this.config.get<number>('TAX_DOCUMENTS_WORKER_BATCH_SIZE') ?? 10;
  }

  get maxAttempts(): number {
    return this.config.get<number>('TAX_DOCUMENTS_MAX_ATTEMPTS') ?? 8;
  }

  get retryBaseMs(): number {
    return (
      (this.config.get<number>('TAX_DOCUMENTS_RETRY_BASE_SECONDS') ?? 30) * 1000
    );
  }

  get leaseSeconds(): number {
    return LEASE_SECONDS;
  }

  get timeoutMs(): number {
    return this.config.get<number>('OPENFACTURA_TIMEOUT_MS') ?? 15000;
  }

  baseUrl(environment: TaxProviderEnvironmentName): string {
    const raw =
      environment === 'PRODUCTION'
        ? (this.config.get<string>('OPENFACTURA_PRODUCTION_BASE_URL') ??
          DEFAULT_PRODUCTION_BASE_URL)
        : (this.config.get<string>('OPENFACTURA_SANDBOX_BASE_URL') ??
          DEFAULT_SANDBOX_BASE_URL);

    return raw.replace(/\/+$/, '');
  }
}

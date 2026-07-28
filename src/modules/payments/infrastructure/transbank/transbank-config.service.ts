import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Environment } from 'transbank-sdk';

export type TransbankEnvironment = 'integration' | 'production';

const TRANSBANK_DEFAULT_TIMEOUT_MS = 15000;
const TRANSBANK_DEFAULT_RECONCILIATION_INTERVAL_MS = 5 * 60 * 1000;
const TRANSBANK_DEFAULT_RECONCILIATION_MIN_AGE_MINUTES = 10;

@Injectable()
export class TransbankConfigService {
  private readonly logger = new Logger(TransbankConfigService.name);
  readonly isEnabled: boolean;

  constructor(private readonly configService: ConfigService) {
    this.isEnabled =
      this.configService.get<boolean>('TRANSBANK_ENABLED') ?? false;

    if (!this.isEnabled) {
      this.logger.warn(
        'Transbank Webpay no esta habilitado (TRANSBANK_ENABLED=false) - la conexion de cuentas Transbank queda deshabilitada.',
      );
    }
  }

  get mallCommerceCode(): string {
    return this.getRequiredConfig('TRANSBANK_MALL_COMMERCE_CODE');
  }

  get apiKey(): string {
    return this.getRequiredConfig('TRANSBANK_API_KEY');
  }

  get environment(): TransbankEnvironment {
    return (
      this.configService.get<TransbankEnvironment>('TRANSBANK_ENVIRONMENT') ??
      'integration'
    );
  }

  get environmentUrl(): string {
    return this.environment === 'production'
      ? Environment.Production
      : Environment.Integration;
  }

  get returnUrl(): string {
    return this.getRequiredConfig('TRANSBANK_RETURN_URL');
  }

  get timeoutMs(): number {
    return (
      this.configService.get<number>('TRANSBANK_TIMEOUT_MS') ??
      TRANSBANK_DEFAULT_TIMEOUT_MS
    );
  }

  get reconciliationIntervalMs(): number {
    return (
      this.configService.get<number>('TRANSBANK_RECONCILIATION_INTERVAL_MS') ??
      TRANSBANK_DEFAULT_RECONCILIATION_INTERVAL_MS
    );
  }

  get reconciliationMinAgeMinutes(): number {
    return (
      this.configService.get<number>(
        'TRANSBANK_RECONCILIATION_MIN_AGE_MINUTES',
      ) ?? TRANSBANK_DEFAULT_RECONCILIATION_MIN_AGE_MINUTES
    );
  }

  private getRequiredConfig(name: string): string {
    const value = this.configService.get<string>(name);

    if (!this.isEnabled || !value) {
      throw new Error(
        `Transbank Webpay no esta configurado. Falta ${name} o TRANSBANK_ENABLED=false.`,
      );
    }

    return value;
  }
}

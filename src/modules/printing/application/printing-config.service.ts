import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const SERVER_LEASE_SECONDS = 30;
const DEVICE_LEASE_SECONDS = 45;
const LATE_MINUTES = 10;
const ALERT_COOLDOWN_MS = 10 * 60 * 1000;
const DONE_RETENTION_DAYS = 30;
const FAILED_RETENTION_DAYS = 90;
const STUCK_CLAIM_MINUTES = 5;
const DEVICE_OFFLINE_SECONDS = 90;
const DEV_PAIRING_SECRET = 'sazono-dev-pairing-secret-not-for-production';

@Injectable()
export class PrintingConfigService {
  constructor(private readonly config: ConfigService) {}

  get workerEnabled(): boolean {
    if (this.config.get<string>('NODE_ENV') === 'test') {
      return false;
    }

    return this.config.get<boolean>('PRINTING_WORKER_ENABLED') ?? true;
  }

  get intervalMs(): number {
    return this.config.get<number>('PRINTING_WORKER_INTERVAL_MS') ?? 2000;
  }

  get reconcileIntervalMs(): number {
    return this.config.get<number>('PRINTING_RECONCILE_INTERVAL_MS') ?? 60000;
  }

  get batchSize(): number {
    return this.config.get<number>('PRINTING_WORKER_BATCH_SIZE') ?? 10;
  }

  get maxAttempts(): number {
    return this.config.get<number>('PRINTING_MAX_ATTEMPTS') ?? 6;
  }

  get retryBaseMs(): number {
    return (this.config.get<number>('PRINTING_RETRY_BASE_SECONDS') ?? 5) * 1000;
  }

  get tcpEnabled(): boolean {
    return this.config.get<boolean>('PRINTING_TCP_ENABLED') ?? false;
  }

  get tcpAllowLocal(): boolean {
    return this.config.get<string>('NODE_ENV') !== 'production';
  }

  get tcpConnectTimeoutMs(): number {
    return this.config.get<number>('PRINTING_TCP_CONNECT_TIMEOUT_MS') ?? 3000;
  }

  get tcpWriteTimeoutMs(): number {
    return this.config.get<number>('PRINTING_TCP_WRITE_TIMEOUT_MS') ?? 5000;
  }

  get pairingTtlMinutes(): number {
    return this.config.get<number>('PRINTING_PAIRING_TTL_MINUTES') ?? 10;
  }

  get pairingSecret(): string {
    const secret =
      this.config.get<string>('PRINTING_PAIRING_SECRET') ||
      this.config.get<string>('PAYMENTS_ENCRYPTION_KEY');

    if (secret) {
      return secret;
    }

    if (this.config.get<string>('NODE_ENV') === 'production') {
      throw new Error('PRINTING_PAIRING_SECRET no esta configurada.');
    }

    return DEV_PAIRING_SECRET;
  }

  get longPollMaxSeconds(): number {
    return this.config.get<number>('PRINTING_LONGPOLL_MAX_SECONDS') ?? 25;
  }

  get wakePushEnabled(): boolean {
    return this.config.get<boolean>('PRINTING_WAKE_PUSH_ENABLED') ?? true;
  }

  get serverLeaseSeconds(): number {
    return SERVER_LEASE_SECONDS;
  }

  get deviceLeaseSeconds(): number {
    return DEVICE_LEASE_SECONDS;
  }

  get lateMinutes(): number {
    return LATE_MINUTES;
  }

  get alertCooldownMs(): number {
    return ALERT_COOLDOWN_MS;
  }

  get doneRetentionDays(): number {
    return DONE_RETENTION_DAYS;
  }

  get failedRetentionDays(): number {
    return FAILED_RETENTION_DAYS;
  }

  get stuckClaimMinutes(): number {
    return STUCK_CLAIM_MINUTES;
  }

  get deviceOfflineSeconds(): number {
    return DEVICE_OFFLINE_SECONDS;
  }
}

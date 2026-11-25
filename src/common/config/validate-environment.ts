import { plainToInstance, Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsUrl,
  Max,
  IsString,
  Min,
  MinLength,
  validateSync,
} from 'class-validator';

function toBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();

    if (['true', '1', 'yes', 'on'].includes(normalized)) {
      return true;
    }

    if (['false', '0', 'no', 'off'].includes(normalized)) {
      return false;
    }
  }

  return fallback;
}

function toNumber(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);

    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return fallback;
}

class EnvironmentVariables {
  @IsOptional()
  @IsIn(['development', 'test', 'production'])
  NODE_ENV?: 'development' | 'test' | 'production';

  @Transform(({ value }) => toNumber(value, 3000))
  @IsInt()
  @Min(1)
  PORT = 3000;

  @IsOptional()
  @IsString()
  API_PREFIX = 'api';

  @Transform(({ value }) => toBoolean(value, true))
  @IsBoolean()
  SWAGGER_ENABLED = true;

  @IsOptional()
  @IsIn(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
  LOG_LEVEL = 'info';

  @Transform(({ value }) => toBoolean(value, true))
  @IsBoolean()
  CORS_ENABLED = true;

  @IsOptional()
  @IsString()
  CORS_ORIGIN = '*';

  @Transform(({ value }) => toNumber(value, 0))
  @IsInt()
  @Min(0)
  @Max(10)
  TRUST_PROXY_HOPS = 0;

  @Transform(({ value }) => toNumber(value, 60))
  @IsInt()
  @Min(1)
  THROTTLE_TTL_SECONDS = 60;

  @Transform(({ value }) => toNumber(value, 100))
  @IsInt()
  @Min(1)
  THROTTLE_LIMIT = 100;

  @IsString()
  JWT_ACCESS_TOKEN_SECRET = 'change-me';

  @IsString()
  JWT_ACCESS_TOKEN_EXPIRES_IN = '15m';

  @IsString()
  JWT_REFRESH_TOKEN_SECRET = 'change-me-refresh';

  @IsString()
  JWT_REFRESH_TOKEN_EXPIRES_IN = '30d';

  @IsString()
  SUPABASE_URL = '';

  @IsString()
  SUPABASE_ANON_KEY = '';

  @IsString()
  SUPABASE_SERVICE_ROLE_KEY = '';

  @Transform(({ value }) => toBoolean(value, false))
  @IsBoolean()
  OTEL_ENABLED = false;

  @IsOptional()
  @IsString()
  OTEL_SERVICE_NAME = 'sazono-backend-monolith';

  @IsOptional()
  @IsString()
  OTEL_EXPORTER_OTLP_ENDPOINT?: string;

  @Transform(({ value }) => toBoolean(value, false))
  @IsBoolean()
  OTEL_DEBUG = false;

  @Transform(({ value }) => toBoolean(value, false))
  @IsBoolean()
  PRISMA_CONNECT_ON_STARTUP = false;

  @IsOptional()
  @IsString()
  DATABASE_URL?: string;

  @Transform(({ value }) => toNumber(value, 10))
  @IsInt()
  @Min(1)
  DB_POOL_MAX = 10;

  @Transform(({ value }) => toNumber(value, 10000))
  @IsInt()
  @Min(1)
  DB_TX_MAX_WAIT_MS = 10000;

  @Transform(({ value }) => toNumber(value, 15000))
  @IsInt()
  @Min(1)
  DB_TX_TIMEOUT_MS = 15000;

  @IsOptional()
  @IsString()
  DIRECT_URL?: string;

  @IsOptional()
  @IsString()
  FIREBASE_PROJECT_ID?: string;

  @IsOptional()
  @IsString()
  FIREBASE_CLIENT_EMAIL?: string;

  @IsOptional()
  @IsString()
  FIREBASE_PRIVATE_KEY?: string;

  @Transform(({ value }) => toBoolean(value, false))
  @IsBoolean()
  MERCADOPAGO_ENABLED = false;

  @IsOptional()
  @IsString()
  MERCADOPAGO_CLIENT_ID?: string;

  @IsOptional()
  @IsString()
  MERCADOPAGO_CLIENT_SECRET?: string;

  @IsOptional()
  @IsIn(['sandbox', 'production'])
  MERCADOPAGO_ENVIRONMENT?: 'sandbox' | 'production';

  @IsOptional()
  @IsString()
  MERCADOPAGO_OAUTH_REDIRECT_URI?: string;

  @IsOptional()
  @IsString()
  MERCADOPAGO_WEBHOOK_URL?: string;

  @IsOptional()
  @IsString()
  MERCADOPAGO_WEBHOOK_SECRET?: string;

  @Transform(({ value }) => toNumber(value, 300))
  @IsInt()
  @Min(1)
  MERCADOPAGO_WEBHOOK_TOLERANCE_SECONDS = 300;

  @Transform(({ value }) => toBoolean(value, false))
  @IsBoolean()
  MERCADOPAGO_OAUTH_PKCE_ENABLED = false;

  @IsOptional()
  @IsString()
  PAYMENTS_ENCRYPTION_KEY?: string;

  @IsOptional()
  @IsString()
  PAYMENTS_OAUTH_UI_RETURN_URL?: string;

  @Transform(({ value }) => toBoolean(value, false))
  @IsBoolean()
  PAYMENTS_QR_GATEWAY_REQUIRED = false;

  @Transform(({ value }) => toNumber(value, 0))
  @IsInt()
  @Min(0)
  PAYMENTS_APPLICATION_FEE_BPS = 0;

  @Transform(({ value }) => toBoolean(value, true))
  @IsBoolean()
  PLATFORM_FEE_SCHEDULER_ENABLED = true;

  @IsIn(['payments', 'orders'])
  MERCADOPAGO_API_MODE: 'payments' | 'orders' = 'payments';

  @Transform(({ value }) => toNumber(value, 15000))
  @IsInt()
  @Min(1)
  MERCADOPAGO_TIMEOUT_MS = 15000;

  @Transform(({ value }) => toNumber(value, 5 * 60 * 1000))
  @IsInt()
  @Min(1)
  MERCADOPAGO_RECONCILIATION_INTERVAL_MS = 5 * 60 * 1000;

  @Transform(({ value }) => toNumber(value, 5))
  @IsInt()
  @Min(1)
  MERCADOPAGO_RECONCILIATION_MIN_AGE_MINUTES = 5;

  @Transform(({ value }) => toBoolean(value, false))
  @IsBoolean()
  TRANSBANK_ENABLED = false;

  @IsOptional()
  @IsString()
  TRANSBANK_MALL_COMMERCE_CODE?: string;

  @IsOptional()
  @IsString()
  TRANSBANK_API_KEY?: string;

  @IsOptional()
  @IsIn(['integration', 'production'])
  TRANSBANK_ENVIRONMENT?: 'integration' | 'production';

  @IsOptional()
  @IsString()
  TRANSBANK_RETURN_URL?: string;

  @Transform(({ value }) => toNumber(value, 15000))
  @IsInt()
  @Min(1)
  TRANSBANK_TIMEOUT_MS = 15000;

  @Transform(({ value }) => toNumber(value, 5 * 60 * 1000))
  @IsInt()
  @Min(1)
  TRANSBANK_RECONCILIATION_INTERVAL_MS = 5 * 60 * 1000;

  @Transform(({ value }) => toNumber(value, 10))
  @IsInt()
  @Min(1)
  TRANSBANK_RECONCILIATION_MIN_AGE_MINUTES = 10;

  @Transform(({ value }) => toBoolean(value, true))
  @IsBoolean()
  REFUND_RECONCILIATION_ENABLED = true;

  @Transform(({ value }) => toNumber(value, 2 * 60 * 1000))
  @IsInt()
  @Min(1000)
  REFUND_RECONCILIATION_INTERVAL_MS = 2 * 60 * 1000;

  @Transform(({ value }) => toNumber(value, 2))
  @IsInt()
  @Min(1)
  REFUND_RECONCILIATION_MIN_AGE_MINUTES = 2;

  @Transform(({ value }) => toNumber(value, 10))
  @IsInt()
  @Min(1)
  REFUND_RECONCILIATION_MAX_ATTEMPTS = 10;

  @Transform(({ value }) => toNumber(value, 48))
  @IsInt()
  @Min(1)
  REFUND_RECONCILIATION_MAX_AGE_HOURS = 48;

  @IsOptional()
  @IsUrl({
    require_protocol: true,
    require_tld: false,
    protocols: ['http', 'https'],
  })
  OPENFACTURA_SANDBOX_BASE_URL = 'https://dev-api.haulmer.com';

  @IsOptional()
  @IsUrl({
    require_protocol: true,
    require_tld: false,
    protocols: ['http', 'https'],
  })
  OPENFACTURA_PRODUCTION_BASE_URL = 'https://api.haulmer.com';

  @Transform(({ value }) => toNumber(value, 15000))
  @IsInt()
  @Min(1)
  OPENFACTURA_TIMEOUT_MS = 15000;

  @Transform(({ value }) => toBoolean(value, true))
  @IsBoolean()
  TAX_DOCUMENTS_WORKER_ENABLED = true;

  @Transform(({ value }) => toNumber(value, 15000))
  @IsInt()
  @Min(1000)
  TAX_DOCUMENTS_WORKER_INTERVAL_MS = 15000;

  @Transform(({ value }) => toNumber(value, 10))
  @IsInt()
  @Min(1)
  @Max(100)
  TAX_DOCUMENTS_WORKER_BATCH_SIZE = 10;

  @Transform(({ value }) => toNumber(value, 8))
  @IsInt()
  @Min(1)
  @Max(50)
  TAX_DOCUMENTS_MAX_ATTEMPTS = 8;

  @Transform(({ value }) => toNumber(value, 30))
  @IsInt()
  @Min(1)
  TAX_DOCUMENTS_RETRY_BASE_SECONDS = 30;

  @Transform(({ value }) => toBoolean(value, true))
  @IsBoolean()
  PRINTING_WORKER_ENABLED = true;

  @Transform(({ value }) => toNumber(value, 2000))
  @IsInt()
  @Min(500)
  PRINTING_WORKER_INTERVAL_MS = 2000;

  @Transform(({ value }) => toNumber(value, 60000))
  @IsInt()
  @Min(5000)
  PRINTING_RECONCILE_INTERVAL_MS = 60000;

  @Transform(({ value }) => toNumber(value, 10))
  @IsInt()
  @Min(1)
  @Max(100)
  PRINTING_WORKER_BATCH_SIZE = 10;

  @Transform(({ value }) => toNumber(value, 6))
  @IsInt()
  @Min(1)
  @Max(50)
  PRINTING_MAX_ATTEMPTS = 6;

  @Transform(({ value }) => toNumber(value, 5))
  @IsInt()
  @Min(1)
  PRINTING_RETRY_BASE_SECONDS = 5;

  @Transform(({ value }) => toBoolean(value, false))
  @IsBoolean()
  PRINTING_TCP_ENABLED = false;

  @Transform(({ value }) => toNumber(value, 3000))
  @IsInt()
  @Min(500)
  PRINTING_TCP_CONNECT_TIMEOUT_MS = 3000;

  @Transform(({ value }) => toNumber(value, 5000))
  @IsInt()
  @Min(500)
  PRINTING_TCP_WRITE_TIMEOUT_MS = 5000;

  @Transform(({ value }) => toNumber(value, 10))
  @IsInt()
  @Min(1)
  @Max(60)
  PRINTING_PAIRING_TTL_MINUTES = 10;

  @Transform(({ value }) => toNumber(value, 25))
  @IsInt()
  @Min(1)
  @Max(55)
  PRINTING_LONGPOLL_MAX_SECONDS = 25;

  @Transform(({ value }) => toBoolean(value, true))
  @IsBoolean()
  PRINTING_WAKE_PUSH_ENABLED = true;

  @IsOptional()
  @IsString()
  @MinLength(32)
  PRINTING_PAIRING_SECRET?: string;

  @Transform(({ value }) => toNumber(value, 10))
  @IsInt()
  @Min(1)
  @Max(1440)
  KITCHEN_READY_VISIBLE_MINUTES = 10;

  @Transform(({ value }) => toNumber(value, 12))
  @IsInt()
  @Min(1)
  @Max(720)
  KITCHEN_STALE_TICKET_HOURS = 12;
}

const MERCADOPAGO_REQUIRED_VARIABLE_NAMES: Array<keyof EnvironmentVariables> = [
  'MERCADOPAGO_CLIENT_ID',
  'MERCADOPAGO_CLIENT_SECRET',
  'MERCADOPAGO_OAUTH_REDIRECT_URI',
  'MERCADOPAGO_WEBHOOK_URL',
  'MERCADOPAGO_WEBHOOK_SECRET',
  'PAYMENTS_OAUTH_UI_RETURN_URL',
  'PAYMENTS_ENCRYPTION_KEY',
];

const TRANSBANK_REQUIRED_VARIABLE_NAMES: Array<keyof EnvironmentVariables> = [
  'TRANSBANK_MALL_COMMERCE_CODE',
  'TRANSBANK_API_KEY',
  'TRANSBANK_RETURN_URL',
];

const PAYMENTS_ENCRYPTION_KEY_LENGTH_BYTES = 32;

function validateMercadoPagoCrossFields(
  validatedConfig: EnvironmentVariables,
): void {
  if (!validatedConfig.MERCADOPAGO_ENABLED) {
    return;
  }

  const missingVariableNames = MERCADOPAGO_REQUIRED_VARIABLE_NAMES.filter(
    (variableName) => !validatedConfig[variableName],
  );

  if (missingVariableNames.length > 0) {
    throw new Error(
      `MERCADOPAGO_ENABLED=true requiere las siguientes variables: ${missingVariableNames.join(', ')}`,
    );
  }

  const encryptionKeyBytes = Buffer.from(
    validatedConfig.PAYMENTS_ENCRYPTION_KEY as string,
    'base64',
  );

  if (encryptionKeyBytes.length !== PAYMENTS_ENCRYPTION_KEY_LENGTH_BYTES) {
    throw new Error(
      `PAYMENTS_ENCRYPTION_KEY debe decodificar a ${PAYMENTS_ENCRYPTION_KEY_LENGTH_BYTES} bytes en base64 (se obtuvieron ${encryptionKeyBytes.length}). Genera una con: openssl rand -base64 32`,
    );
  }
}

function validateTransbankCrossFields(
  validatedConfig: EnvironmentVariables,
): void {
  if (!validatedConfig.TRANSBANK_ENABLED) {
    return;
  }

  const missingVariableNames = TRANSBANK_REQUIRED_VARIABLE_NAMES.filter(
    (variableName) => !validatedConfig[variableName],
  );

  if (missingVariableNames.length > 0) {
    throw new Error(
      `TRANSBANK_ENABLED=true requiere las siguientes variables: ${missingVariableNames.join(', ')}`,
    );
  }
}

function validatePairingSecret(validatedConfig: EnvironmentVariables): void {
  if (
    validatedConfig.NODE_ENV === 'production' &&
    !validatedConfig.PRINTING_PAIRING_SECRET &&
    !validatedConfig.PAYMENTS_ENCRYPTION_KEY
  ) {
    throw new Error(
      'En produccion se requiere PRINTING_PAIRING_SECRET (minimo 32 caracteres) o PAYMENTS_ENCRYPTION_KEY para firmar los codigos de emparejamiento de impresion.',
    );
  }
}

export function validateEnvironment(config: Record<string, unknown>) {
  const validatedConfig = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: false,
  });

  const errors = validateSync(validatedConfig, {
    skipMissingProperties: false,
  });

  if (errors.length > 0) {
    throw new Error(errors.toString());
  }

  validateMercadoPagoCrossFields(validatedConfig);
  validateTransbankCrossFields(validatedConfig);
  validatePairingSecret(validatedConfig);

  return validatedConfig;
}

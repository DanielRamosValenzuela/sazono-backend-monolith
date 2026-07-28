import { plainToInstance, Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Min,
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

  @Transform(({ value }) => toNumber(value, 15000))
  @IsInt()
  @Min(1)
  MERCADOPAGO_TIMEOUT_MS = 15000;

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

  return validatedConfig;
}

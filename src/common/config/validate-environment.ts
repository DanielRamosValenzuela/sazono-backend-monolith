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

  return validatedConfig;
}

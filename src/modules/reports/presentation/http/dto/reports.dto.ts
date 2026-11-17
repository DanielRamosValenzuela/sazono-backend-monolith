import { ApiPropertyOptional } from '@nestjs/swagger';
import { PaymentAttemptStatus, PaymentStatus } from '@prisma/client';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { MAX_PAGE_LIMIT, METHOD_KEYS } from '../../../application/report-types';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const METHOD_LIST_PATTERN = /^[A-Z_]+(,[A-Z_]+)*$/;
const REPORT_STATUSES = [
  ...new Set([
    ...Object.values(PaymentStatus),
    ...Object.values(PaymentAttemptStatus),
  ]),
];

export class ReportRangeQueryDto {
  @ApiPropertyOptional({
    example: '2026-11-01',
    description:
      'Inicio del rango (inclusive, YYYY-MM-DD en la zona horaria del restaurante). Obligatorio para ADMIN y SUPERVISOR; para CASHIER se ignora y se fuerza el dia de hoy.',
  })
  @IsOptional()
  @Matches(DATE_PATTERN)
  from?: string;

  @ApiPropertyOptional({
    example: '2026-11-17',
    description:
      'Fin del rango (inclusive, YYYY-MM-DD). Maximo 366 dias (92 para CSV).',
  })
  @IsOptional()
  @Matches(DATE_PATTERN)
  to?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'Filtra por el usuario staff que cobro. Para CASHIER se ignora y se fuerza su propio id.',
  })
  @IsOptional()
  @IsUUID()
  cashierId?: string;

  @ApiPropertyOptional({
    example: 'CASH,CREDIT_CARD',
    description: `Lista separada por comas de medios de pago. Valores: ${METHOD_KEYS.join(', ')}.`,
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  @Matches(METHOD_LIST_PATTERN)
  method?: string;

  @ApiPropertyOptional({
    description: 'Cursor opaco devuelto en nextCursor de la pagina anterior.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  cursor?: string;

  @ApiPropertyOptional({ example: 50, minimum: 1, maximum: MAX_PAGE_LIMIT })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_LIMIT)
  limit?: number;

  @ApiPropertyOptional({ enum: ['json', 'csv'], default: 'json' })
  @IsOptional()
  @IsIn(['json', 'csv'])
  format?: 'json' | 'csv';
}

export class PaymentsReportQueryDto extends ReportRangeQueryDto {
  @ApiPropertyOptional({ enum: ['payment', 'attempt', 'all'], default: 'all' })
  @IsOptional()
  @IsIn(['payment', 'attempt', 'all'])
  kind?: 'payment' | 'attempt' | 'all';

  @ApiPropertyOptional({
    example: 'MANUAL',
    description: 'Proveedor del pago: MANUAL, MERCADO_PAGO o TRANSBANK.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  provider?: string;

  @ApiPropertyOptional({
    enum: REPORT_STATUSES,
    description:
      'Estado del pago (PAID, REFUNDED...) o del intento sin pago (PENDING, FAILED, CANCELLED).',
  })
  @IsOptional()
  @IsIn(REPORT_STATUSES)
  paymentStatus?: string;
}

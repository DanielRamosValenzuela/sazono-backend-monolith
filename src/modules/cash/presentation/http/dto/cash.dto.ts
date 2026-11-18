import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CashMovementType, CashSessionStatus } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsISO8601,
  IsObject,
  IsOptional,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

export const CASH_MONEY_PATTERN = /^(0|[1-9]\d{0,9})$/;
export const CASH_POSITIVE_PATTERN = /^[1-9]\d{0,9}$/;
export const CASH_SIGNED_PATTERN = /^-?[1-9]\d{0,9}$/;
const NO_CONTROL_CHARS_PATTERN = /^[^\p{Cc}]*$/u;

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class OpenCashSessionDto {
  @ApiPropertyOptional({ example: 'Caja 1' })
  @IsOptional()
  @Transform(trim)
  @Length(1, 40)
  @Matches(NO_CONTROL_CHARS_PATTERN)
  registerLabel?: string;

  @ApiProperty({ example: '20000' })
  @Matches(CASH_MONEY_PATTERN, {
    message: 'El fondo inicial debe ser un numero entero de pesos.',
  })
  openingFloat!: string;
}

export class CloseCashSessionDto {
  @ApiProperty({ example: '64000' })
  @Matches(CASH_MONEY_PATTERN, {
    message: 'El efectivo contado debe ser un numero entero de pesos.',
  })
  countedCash!: string;

  @ApiPropertyOptional({
    description: 'Obligatoria si hay diferencia (minimo 3 caracteres).',
  })
  @IsOptional()
  @Transform(trim)
  @MaxLength(500)
  @Matches(NO_CONTROL_CHARS_PATTERN)
  closingNote?: string;

  @ApiPropertyOptional({
    example: { '20000': 2, '10000': 1 },
    description: 'Conteo por denominacion: { valor: cantidad }.',
  })
  @IsOptional()
  @IsObject()
  denominations?: Record<string, number>;
}

export class CreateCashMovementDto {
  @ApiProperty({ enum: [CashMovementType.CASH_IN, CashMovementType.CASH_OUT] })
  @IsIn([CashMovementType.CASH_IN, CashMovementType.CASH_OUT])
  type!: 'CASH_IN' | 'CASH_OUT';

  @ApiProperty({ example: '5000', description: 'Monto positivo en pesos.' })
  @Matches(CASH_POSITIVE_PATTERN, {
    message: 'El monto debe ser un entero de pesos mayor a cero.',
  })
  amount!: string;

  @ApiProperty({ example: 'Pago a proveedor de hielo' })
  @Transform(trim)
  @Length(3, 300, {
    message: 'El motivo es obligatorio (minimo 3 caracteres).',
  })
  @Matches(NO_CONTROL_CHARS_PATTERN)
  reason!: string;
}

export class CreateCashAdjustmentDto {
  @ApiProperty({
    example: '-500',
    description: 'Monto con signo distinto de 0.',
  })
  @Matches(CASH_SIGNED_PATTERN, {
    message: 'El ajuste debe ser un entero de pesos distinto de cero.',
  })
  amount!: string;

  @ApiProperty()
  @Transform(trim)
  @Length(3, 300, {
    message: 'El motivo es obligatorio (minimo 3 caracteres).',
  })
  @Matches(NO_CONTROL_CHARS_PATTERN)
  reason!: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Sesion abierta a la que se asocia. Por defecto la del actor.',
  })
  @IsOptional()
  @IsUUID()
  cashSessionId?: string;
}

export class ListCashSessionsQueryDto {
  @ApiPropertyOptional({ enum: CashSessionStatus })
  @IsOptional()
  @IsIn(Object.values(CashSessionStatus))
  status?: CashSessionStatus;

  @ApiPropertyOptional({ default: 30 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class ListCashMovementsQueryDto {
  @ApiPropertyOptional({ enum: CashMovementType })
  @IsOptional()
  @IsIn(Object.values(CashMovementType))
  type?: CashMovementType;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  cashSessionId?: string;

  @ApiPropertyOptional({ example: '2026-11-18T00:00:00.000Z' })
  @IsOptional()
  @IsISO8601()
  from?: string;

  @ApiPropertyOptional({ example: '2026-11-19T00:00:00.000Z' })
  @IsOptional()
  @IsISO8601()
  to?: string;

  @ApiPropertyOptional({ default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}

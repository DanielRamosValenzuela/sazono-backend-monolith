import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  TableSessionOpenedBySource,
  TableSessionStatus,
  TableStatus,
} from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';

const INTERNAL_TABLE_SESSION_OPENED_BY_SOURCES = [
  TableSessionOpenedBySource.WAITER,
  TableSessionOpenedBySource.CASHIER,
] as const;

class CurrentTableSessionSummaryDto {
  @ApiProperty({ format: 'uuid' })
  tableSessionId!: string;

  @ApiProperty({ enum: TableSessionStatus, enumName: 'TableSessionStatus' })
  status!: TableSessionStatus;

  @ApiProperty({
    enum: TableSessionOpenedBySource,
    enumName: 'TableSessionOpenedBySource',
  })
  openedBySource!: TableSessionOpenedBySource;

  @ApiProperty()
  openedAt!: string;
}

export class CreateTableDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  branchId!: string;

  @ApiProperty({ example: 'M01' })
  @IsString()
  code!: string;

  @ApiProperty({ example: 'Mesa terraza 1' })
  @IsString()
  name!: string;

  @ApiPropertyOptional({ example: 4 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  capacity?: number;
}

export class ListTablesQueryDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  branchId!: string;
}

export class OpenTableSessionDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  tableId!: string;

  @ApiProperty({
    enum: INTERNAL_TABLE_SESSION_OPENED_BY_SOURCES,
    enumName: 'InternalTableSessionOpenedBySource',
  })
  @IsIn(INTERNAL_TABLE_SESSION_OPENED_BY_SOURCES)
  openedBySource!: TableSessionOpenedBySource;
}

export class CloseTableSessionDto {
  @ApiPropertyOptional({
    example: 'Cuenta cerrada manualmente por caja.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(250)
  closeReason?: string;
}

export class TableSessionResponseDto {
  @ApiProperty({ format: 'uuid' })
  tableSessionId!: string;

  @ApiProperty({ format: 'uuid' })
  tableId!: string;

  @ApiProperty({ format: 'uuid' })
  branchId!: string;

  @ApiProperty({ enum: TableSessionStatus, enumName: 'TableSessionStatus' })
  status!: TableSessionStatus;

  @ApiProperty({
    enum: TableSessionOpenedBySource,
    enumName: 'TableSessionOpenedBySource',
  })
  openedBySource!: TableSessionOpenedBySource;

  @ApiProperty()
  openedAt!: string;

  @ApiProperty({ nullable: true, required: false })
  closeReason!: string | null;

  @ApiProperty({ nullable: true, required: false })
  closedAt!: string | null;
}

export class TableResponseDto {
  @ApiProperty({ format: 'uuid' })
  tableId!: string;

  @ApiProperty({ format: 'uuid' })
  branchId!: string;

  @ApiProperty()
  code!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ nullable: true, required: false })
  capacity!: number | null;

  @ApiProperty({ enum: TableStatus, enumName: 'TableStatus' })
  status!: TableStatus;

  @ApiProperty()
  qrToken!: string;

  @ApiPropertyOptional({
    type: CurrentTableSessionSummaryDto,
    nullable: true,
  })
  currentSession!: CurrentTableSessionSummaryDto | null;
}

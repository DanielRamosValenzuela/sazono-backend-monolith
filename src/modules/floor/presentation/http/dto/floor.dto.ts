import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  BillStatus,
  OrderStatus,
  TableSessionOpenedBySource,
  TableSessionStatus,
  TableStatus,
} from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
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

  @ApiProperty({ nullable: true, required: false })
  assignedStaffUserId!: string | null;

  @ApiProperty({ nullable: true, required: false })
  guestCount!: number | null;
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

  @ApiProperty({ example: 4 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(30)
  guestCount!: number;
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

export class AbandonTableSessionDto {
  @ApiProperty({
    example: 'Los clientes se retiraron sin pagar. Reportado por mesero.',
  })
  @IsString()
  @MaxLength(250)
  closeReason!: string;
}

export class AssignTableSessionDto {
  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'Staff a asignar. Si se omite, el solicitante se autoasigna la mesa ("tomar esta mesa"). Asignar a otro staff requiere rol ADMIN o SUPERVISOR.',
  })
  @IsOptional()
  @IsUUID()
  staffUserId?: string;
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

  @ApiProperty({ nullable: true, required: false })
  assignedStaffUserId!: string | null;

  @ApiProperty({ nullable: true, required: false })
  guestCount!: number | null;
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

  @ApiProperty({ nullable: true, required: false, format: 'uuid' })
  zoneId!: string | null;

  @ApiPropertyOptional({
    type: CurrentTableSessionSummaryDto,
    nullable: true,
  })
  currentSession!: CurrentTableSessionSummaryDto | null;
}

export class CreateTableZoneDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  branchId!: string;

  @ApiProperty({ example: 'Terraza' })
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  name!: string;
}

export class RenameTableZoneDto {
  @ApiProperty({ example: 'Terraza' })
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  name!: string;
}

export class SetTableZoneDto {
  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  @IsOptional()
  @IsUUID()
  zoneId?: string | null;
}

export class SetZoneStaffDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @IsUUID('4', { each: true })
  staffUserIds!: string[];
}

export class TableZoneResponseDto {
  @ApiProperty({ format: 'uuid' })
  zoneId!: string;

  @ApiProperty({ format: 'uuid' })
  branchId!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ type: [String] })
  tableIds!: string[];

  @ApiProperty({ type: [String] })
  staffUserIds!: string[];
}

export class BranchStaffMemberResponseDto {
  @ApiProperty({ format: 'uuid' })
  staffUserId!: string;

  @ApiProperty()
  firstName!: string;

  @ApiProperty()
  lastName!: string;
}

const trimString = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class OpenCounterSessionDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  branchId!: string;

  @ApiPropertyOptional({ example: 'Ana', maxLength: 40 })
  @IsOptional()
  @Transform(trimString)
  @IsString()
  @MaxLength(40)
  customerLabel?: string;
}

export class RenameCounterSessionDto {
  @ApiProperty({
    example: 'Ana',
    maxLength: 40,
    description: 'Cadena vacia borra el nombre.',
  })
  @Transform(trimString)
  @IsString()
  @MaxLength(40)
  customerLabel!: string;
}

export class ListCounterSessionsQueryDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  branchId!: string;

  @ApiPropertyOptional({
    description: 'Si es true, solo los tickets abiertos por el solicitante.',
  })
  @IsOptional()
  @Transform(({ obj, key }: { obj: Record<string, unknown>; key: string }) => {
    const raw = obj[key];

    if (raw === 'true' || raw === true) {
      return true;
    }

    return raw === 'false' || raw === false ? false : raw;
  })
  @IsBoolean()
  mine?: boolean;
}

export class CounterSessionResponseDto {
  @ApiProperty({ format: 'uuid' })
  tableSessionId!: string;

  @ApiProperty({ format: 'uuid' })
  tableId!: string;

  @ApiProperty({ format: 'uuid' })
  branchId!: string;

  @ApiProperty({ format: 'uuid', nullable: true })
  billId!: string | null;

  @ApiProperty({ example: 12 })
  ticketNumber!: number;

  @ApiProperty({ nullable: true })
  customerLabel!: string | null;

  @ApiProperty({ enum: TableSessionStatus, enumName: 'TableSessionStatus' })
  status!: TableSessionStatus;

  @ApiProperty({ nullable: true })
  openedByStaffUserId!: string | null;

  @ApiProperty({ nullable: true })
  assignedStaffUserId!: string | null;

  @ApiProperty()
  openedAt!: string;
}

export class CounterSessionBillDto {
  @ApiProperty({ enum: BillStatus, enumName: 'BillStatus' })
  status!: BillStatus;

  @ApiProperty({ example: '0.00' })
  discount!: string;

  @ApiProperty({ example: '4500.00' })
  total!: string;

  @ApiProperty({ example: '1000.00' })
  paid!: string;

  @ApiProperty({ example: '3500.00' })
  remaining!: string;
}

export class CounterSessionOrderSummaryDto {
  @ApiProperty({ format: 'uuid' })
  orderId!: string;

  @ApiProperty({ enum: OrderStatus, enumName: 'OrderStatus' })
  status!: OrderStatus;
}

export const COUNTER_READINESS_VALUES = [
  'EMPTY',
  'WAITING',
  'PREPARING',
  'PARTIALLY_READY',
  'READY',
  'DELIVERED',
] as const;

export class CounterSessionListItemDto {
  @ApiProperty({ format: 'uuid' })
  tableSessionId!: string;

  @ApiProperty({ format: 'uuid' })
  billId!: string;

  @ApiProperty({ example: 12 })
  ticketNumber!: number;

  @ApiProperty({ nullable: true })
  customerLabel!: string | null;

  @ApiProperty({ enum: TableSessionStatus, enumName: 'TableSessionStatus' })
  status!: TableSessionStatus;

  @ApiProperty({ nullable: true })
  openedByStaffUserId!: string | null;

  @ApiProperty()
  openedAt!: string;

  @ApiProperty({ type: CounterSessionBillDto })
  bill!: CounterSessionBillDto;

  @ApiProperty({ type: [CounterSessionOrderSummaryDto] })
  orders!: CounterSessionOrderSummaryDto[];

  @ApiProperty({
    enum: COUNTER_READINESS_VALUES,
    enumName: 'CounterReadiness',
  })
  readiness!: (typeof COUNTER_READINESS_VALUES)[number];

  @ApiPropertyOptional({
    description: 'Cuando readiness es READY: momento en que quedo listo.',
  })
  readyAt?: string;
}

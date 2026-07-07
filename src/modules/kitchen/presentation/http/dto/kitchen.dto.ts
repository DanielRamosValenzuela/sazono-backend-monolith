import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  OrderItemStatus,
  OrderSource,
  StationTicketStatus,
  PreparationStationType,
} from '@prisma/client';
import { IsEnum, IsOptional, IsUUID } from 'class-validator';

export class ListStationTicketsQueryDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  branchId!: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  preparationStationId?: string;

  @ApiPropertyOptional({
    enum: StationTicketStatus,
    enumName: 'StationTicketStatus',
  })
  @IsOptional()
  @IsEnum(StationTicketStatus)
  status?: StationTicketStatus;
}

export class UpdateStationTicketStatusDto {
  @ApiProperty({
    enum: StationTicketStatus,
    enumName: 'StationTicketStatus',
  })
  @IsEnum(StationTicketStatus)
  status!: StationTicketStatus;
}

class StationTicketItemResponseDto {
  @ApiProperty({ format: 'uuid' })
  stationTicketItemId!: string;

  @ApiProperty({ format: 'uuid' })
  orderItemId!: string;

  @ApiProperty({ example: 'Pisco Sour' })
  name!: string;

  @ApiProperty({ example: 2 })
  quantity!: number;

  @ApiProperty({ enum: OrderItemStatus, enumName: 'OrderItemStatus' })
  status!: OrderItemStatus;

  @ApiProperty({ nullable: true, required: false })
  notes!: string | null;
}

export class StationTicketResponseDto {
  @ApiProperty({ format: 'uuid' })
  stationTicketId!: string;

  @ApiProperty({ format: 'uuid' })
  orderId!: string;

  @ApiProperty({ format: 'uuid' })
  branchId!: string;

  @ApiProperty({ format: 'uuid' })
  preparationStationId!: string;

  @ApiProperty()
  stationName!: string;

  @ApiProperty({
    enum: PreparationStationType,
    enumName: 'PreparationStationType',
  })
  stationType!: PreparationStationType;

  @ApiProperty({ enum: StationTicketStatus, enumName: 'StationTicketStatus' })
  status!: StationTicketStatus;

  @ApiProperty({ enum: OrderSource, enumName: 'OrderSource' })
  orderSource!: OrderSource;

  @ApiProperty({ example: 'M01' })
  tableCode!: string;

  @ApiProperty({ nullable: true, required: false })
  orderNotes!: string | null;

  @ApiProperty({ nullable: true, required: false })
  sentAt!: string | null;

  @ApiProperty({ nullable: true, required: false })
  startedAt!: string | null;

  @ApiProperty({ nullable: true, required: false })
  completedAt!: string | null;

  @ApiProperty({ type: [StationTicketItemResponseDto] })
  items!: StationTicketItemResponseDto[];
}

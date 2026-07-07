import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  OrderItemStatus,
  OrderSource,
  OrderStatus,
  PaymentPolicy,
  PreparationStationStatus,
  PreparationStationType,
  StationTicketStatus,
} from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class CreateOrderItemDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  menuItemId!: string;

  @ApiProperty({ example: 2, minimum: 1 })
  @IsInt()
  @Min(1)
  @Max(50)
  quantity!: number;

  @ApiPropertyOptional({ example: 'Sin cebolla.' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

export class CreateWaiterOrderDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  tableSessionId!: string;

  @ApiProperty({ type: [CreateOrderItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => CreateOrderItemDto)
  items!: CreateOrderItemDto[];

  @ApiPropertyOptional({ example: 'Ronda dos de la mesa.' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

export class CreateQrOrderDto {
  @ApiProperty({ type: [CreateOrderItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => CreateOrderItemDto)
  items!: CreateOrderItemDto[];

  @ApiPropertyOptional({ example: 'Alergia al mani.' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

export class ListOrdersQueryDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  tableSessionId!: string;
}

export class CancelOrderDto {
  @ApiPropertyOptional({ example: 'Cliente cambio de opinion.' })
  @IsOptional()
  @IsString()
  @MaxLength(250)
  reason?: string;
}

class OrderPreparationStationSummaryDto {
  @ApiProperty({ format: 'uuid' })
  preparationStationId!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({
    enum: PreparationStationType,
    enumName: 'PreparationStationType',
  })
  stationType!: PreparationStationType;

  @ApiProperty({
    enum: PreparationStationStatus,
    enumName: 'PreparationStationStatus',
  })
  status!: PreparationStationStatus;
}

class OrderItemResponseDto {
  @ApiProperty({ format: 'uuid' })
  orderItemId!: string;

  @ApiProperty({ format: 'uuid', nullable: true })
  menuItemId!: string | null;

  @ApiProperty({ example: 'Pisco Sour' })
  name!: string;

  @ApiProperty({ example: '5900' })
  unitPrice!: string;

  @ApiProperty({ example: 2 })
  quantity!: number;

  @ApiProperty({ example: '11800' })
  totalPrice!: string;

  @ApiProperty({ enum: OrderItemStatus, enumName: 'OrderItemStatus' })
  status!: OrderItemStatus;

  @ApiProperty({ nullable: true, required: false })
  notes!: string | null;

  @ApiProperty({ type: OrderPreparationStationSummaryDto })
  preparationStation!: OrderPreparationStationSummaryDto;
}

class OrderStationTicketSummaryDto {
  @ApiProperty({ format: 'uuid' })
  stationTicketId!: string;

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

  @ApiProperty({ nullable: true, required: false })
  sentAt!: string | null;
}

export class OrderResponseDto {
  @ApiProperty({ format: 'uuid' })
  orderId!: string;

  @ApiProperty({ format: 'uuid' })
  tableSessionId!: string;

  @ApiProperty({ format: 'uuid' })
  billId!: string;

  @ApiProperty({ format: 'uuid' })
  branchId!: string;

  @ApiProperty({ enum: OrderSource, enumName: 'OrderSource' })
  source!: OrderSource;

  @ApiProperty({ enum: PaymentPolicy, enumName: 'PaymentPolicy' })
  paymentPolicy!: PaymentPolicy;

  @ApiProperty({ enum: OrderStatus, enumName: 'OrderStatus' })
  status!: OrderStatus;

  @ApiProperty({ nullable: true, required: false })
  notes!: string | null;

  @ApiProperty({ nullable: true, required: false })
  submittedAt!: string | null;

  @ApiProperty()
  createdAt!: string;

  @ApiProperty({ example: '23600' })
  orderTotalAmount!: string;

  @ApiProperty({ type: [OrderItemResponseDto] })
  items!: OrderItemResponseDto[];

  @ApiProperty({ type: [OrderStationTicketSummaryDto] })
  stationTickets!: OrderStationTicketSummaryDto[];
}

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  BillSplitMode,
  BillSplitParticipantStatus,
  BillSplitStatus,
  BillStatus,
  OrderStatus,
  PaymentStatus,
} from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsNumberString,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';

export class PayQrOrderDto {
  @ApiPropertyOptional({
    example: '1000',
    description: 'Propina opcional que se suma al total de la cuenta.',
  })
  @IsOptional()
  @IsNumberString()
  tipAmount?: string;
}

export class PayBillDto {
  @ApiProperty({
    example: '11800',
    description: 'Monto a pagar contra el saldo pendiente de la cuenta.',
  })
  @IsNumberString()
  amount!: string;

  @ApiPropertyOptional({
    example: '1000',
    description: 'Propina opcional que se suma al total de la cuenta.',
  })
  @IsOptional()
  @IsNumberString()
  tipAmount?: string;
}

export class BillSummaryResponseDto {
  @ApiProperty({ format: 'uuid' })
  billId!: string;

  @ApiProperty({ enum: BillStatus, enumName: 'BillStatus' })
  status!: BillStatus;

  @ApiProperty({ example: '23600' })
  subtotalAmount!: string;

  @ApiProperty({ example: '1000' })
  tipAmount!: string;

  @ApiProperty({ example: '24600' })
  totalAmount!: string;

  @ApiProperty({ example: '0' })
  remainingAmount!: string;
}

class PaidOrderSummaryResponseDto {
  @ApiProperty({ format: 'uuid' })
  orderId!: string;

  @ApiProperty({ enum: OrderStatus, enumName: 'OrderStatus' })
  status!: OrderStatus;
}

export class PaymentResultResponseDto {
  @ApiProperty({ format: 'uuid' })
  paymentId!: string;

  @ApiProperty({ format: 'uuid' })
  billId!: string;

  @ApiProperty({ example: '12800' })
  amount!: string;

  @ApiProperty({ example: 'CLP' })
  currency!: string;

  @ApiProperty({ example: 'MANUAL' })
  provider!: string;

  @ApiProperty({ nullable: true, required: false })
  providerReference!: string | null;

  @ApiProperty({ enum: PaymentStatus, enumName: 'PaymentStatus' })
  status!: PaymentStatus;

  @ApiProperty({ nullable: true, required: false })
  paidAt!: string | null;

  @ApiProperty({ type: BillSummaryResponseDto })
  bill!: BillSummaryResponseDto;

  @ApiProperty({
    type: PaidOrderSummaryResponseDto,
    nullable: true,
    required: false,
  })
  order!: PaidOrderSummaryResponseDto | null;
}

export class CreateBillSplitParticipantDto {
  @ApiPropertyOptional({ example: 'Ana' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  displayName?: string;

  @ApiProperty({
    example: '11800',
    description: 'Parte del saldo pendiente asignada a este participante.',
  })
  @IsNumberString()
  amount!: string;
}

export class CreateBillSplitDto {
  @ApiProperty({ type: [CreateBillSplitParticipantDto] })
  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => CreateBillSplitParticipantDto)
  participants!: CreateBillSplitParticipantDto[];
}

export class PayBillSplitParticipantDto {
  @ApiPropertyOptional({
    example: '1000',
    description: 'Propina opcional que se suma al total de la cuenta.',
  })
  @IsOptional()
  @IsNumberString()
  tipAmount?: string;
}

class BillSplitParticipantResponseDto {
  @ApiProperty({ format: 'uuid' })
  participantId!: string;

  @ApiProperty({
    description: 'Token con el que el participante paga su parte desde QR.',
  })
  participantToken!: string;

  @ApiProperty({ nullable: true, required: false })
  displayName!: string | null;

  @ApiProperty({ example: '11800' })
  allocatedAmount!: string;

  @ApiProperty({ example: '0' })
  paidAmount!: string;

  @ApiProperty({
    enum: BillSplitParticipantStatus,
    enumName: 'BillSplitParticipantStatus',
  })
  status!: BillSplitParticipantStatus;
}

export class BillSplitResponseDto {
  @ApiProperty({ format: 'uuid' })
  billSplitId!: string;

  @ApiProperty({ format: 'uuid' })
  billId!: string;

  @ApiProperty({ enum: BillSplitMode, enumName: 'BillSplitMode' })
  splitMode!: BillSplitMode;

  @ApiProperty({ enum: BillSplitStatus, enumName: 'BillSplitStatus' })
  status!: BillSplitStatus;

  @ApiProperty({ type: [BillSplitParticipantResponseDto] })
  participants!: BillSplitParticipantResponseDto[];
}

export class PaymentSummaryResponseDto {
  @ApiProperty({ format: 'uuid' })
  paymentId!: string;

  @ApiProperty({ format: 'uuid' })
  billId!: string;

  @ApiProperty({ example: '12800' })
  amount!: string;

  @ApiProperty({ example: 'CLP' })
  currency!: string;

  @ApiProperty({ example: 'MANUAL' })
  provider!: string;

  @ApiProperty({ nullable: true, required: false })
  providerReference!: string | null;

  @ApiProperty({ enum: PaymentStatus, enumName: 'PaymentStatus' })
  status!: PaymentStatus;

  @ApiProperty({ nullable: true, required: false })
  paidAt!: string | null;

  @ApiProperty()
  createdAt!: string;
}

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

class CreateBranchSettingsDto {
  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  qrOrderingEnabled?: boolean;

  @ApiPropertyOptional({
    example: 'prepaid_order',
    description: 'Modo inicial de pago QR para la sucursal.',
  })
  @IsOptional()
  @IsString()
  qrPaymentMode?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  splitBillEnabled?: boolean;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  partialDeliveryEnabled?: boolean;

  @ApiPropertyOptional({ nullable: true, example: 5 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  autoDeliverAfterMinutes?: number | null;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  tableAssignmentEnabled?: boolean;

  @ApiPropertyOptional({
    nullable: true,
    example: 20000,
    description:
      'Tope diario en pesos por cajero para reembolsos en efectivo sin aprobacion de un administrador. Null desactiva el tope.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(9999999999)
  cashierRefundLimit?: number | null;

  @ApiPropertyOptional({
    default: false,
    description:
      'Valor inicial de Reembolsar propina cuando el reembolso no lo indica.',
  })
  @IsOptional()
  @IsBoolean()
  refundTipDefault?: boolean;
}

export class CreateBranchDto {
  @ApiProperty({ example: 'Providencia' })
  @IsString()
  name!: string;

  @ApiPropertyOptional({ example: 'Av. Providencia 1234, Santiago' })
  @IsOptional()
  @IsString()
  address?: string;

  @ApiPropertyOptional({ type: CreateBranchSettingsDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => CreateBranchSettingsDto)
  settings?: CreateBranchSettingsDto;
}

class CreateBranchSettingsResponseDto {
  @ApiProperty()
  qrOrderingEnabled!: boolean;

  @ApiProperty()
  qrPaymentMode!: string;

  @ApiProperty()
  splitBillEnabled!: boolean;

  @ApiProperty()
  partialDeliveryEnabled!: boolean;

  @ApiProperty({ nullable: true, required: false })
  autoDeliverAfterMinutes!: number | null;

  @ApiProperty()
  tableAssignmentEnabled!: boolean;

  @ApiProperty({ nullable: true, required: false })
  cashierRefundLimit!: string | null;

  @ApiProperty()
  refundTipDefault!: boolean;

  @ApiProperty({ nullable: true, required: false })
  discountApprovalPercent!: string | null;

  @ApiProperty({ nullable: true, required: false })
  discountApprovalAmount!: string | null;
}

export class CreateBranchResponseDto {
  @ApiProperty({ format: 'uuid' })
  branchId!: string;

  @ApiProperty({ format: 'uuid' })
  restaurantId!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ nullable: true, required: false })
  address: string | null = null;

  @ApiProperty({ enum: Role, enumName: 'Role' })
  assignedRole!: Role;

  @ApiProperty({ type: CreateBranchSettingsResponseDto })
  settings!: CreateBranchSettingsResponseDto;
}

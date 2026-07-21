import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BranchStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

class UpdateBranchSettingsDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  qrOrderingEnabled?: boolean;

  @ApiPropertyOptional({
    example: 'prepaid_order',
    description: 'Modo de pago QR de la sucursal.',
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  qrPaymentMode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  splitBillEnabled?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  partialDeliveryEnabled?: boolean;

  @ApiPropertyOptional({
    nullable: true,
    example: 5,
    description:
      'Minutos tras los cuales un pedido listo se marca entregado automaticamente. Null desactiva la auto-entrega (requiere confirmacion manual).',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  autoDeliverAfterMinutes?: number | null;

  @ApiPropertyOptional({
    default: false,
    description:
      'Activa la asignacion formal de mesas a un mesero especifico. Desactivado, el mesero que abrio la mesa sigue siendo la unica referencia (comportamiento historico).',
  })
  @IsOptional()
  @IsBoolean()
  tableAssignmentEnabled?: boolean;
}

export class UpdateBranchDto {
  @ApiPropertyOptional({ example: 'Providencia' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  @ApiPropertyOptional({
    example: 'Av. Providencia 1234, Santiago',
    nullable: true,
  })
  @IsOptional()
  @IsString()
  address?: string | null;

  @ApiPropertyOptional({ enum: BranchStatus, enumName: 'BranchStatus' })
  @IsOptional()
  @IsEnum(BranchStatus)
  status?: BranchStatus;

  @ApiPropertyOptional({
    type: UpdateBranchSettingsDto,
    description:
      'Merge parcial: solo se actualizan los campos de settings enviados.',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => UpdateBranchSettingsDto)
  settings?: UpdateBranchSettingsDto;
}

class BranchSettingsResponseDto {
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
}

export class BranchResponseDto {
  @ApiProperty({ format: 'uuid' })
  branchId!: string;

  @ApiProperty({ format: 'uuid' })
  restaurantId!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ nullable: true, required: false })
  address: string | null = null;

  @ApiProperty({ enum: BranchStatus, enumName: 'BranchStatus' })
  status!: BranchStatus;

  @ApiProperty({ type: BranchSettingsResponseDto })
  settings!: BranchSettingsResponseDto;
}

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
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

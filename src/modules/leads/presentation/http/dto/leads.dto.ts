import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { LeadIntent, LeadStatus } from '@prisma/client';
import {
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class CreateLeadDto {
  @ApiProperty({ example: 'Ana Diaz' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name!: string;

  @ApiProperty({ example: 'ana@mirestaurante.cl' })
  @IsEmail()
  email!: string;

  @ApiPropertyOptional({ example: '+56912345678' })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;

  @ApiPropertyOptional({ example: 'Mi Restaurante' })
  @IsOptional()
  @IsString()
  @MaxLength(160)
  businessName?: string;

  @ApiProperty({ enum: LeadIntent, enumName: 'LeadIntent' })
  @IsEnum(LeadIntent)
  intent!: LeadIntent;

  @ApiPropertyOptional({
    example: 'Nos interesa probar Sazono en 2 sucursales.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  message?: string;
}

export class LeadResponseDto {
  @ApiProperty({ format: 'uuid' })
  leadId!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  email!: string;

  @ApiProperty({ nullable: true, required: false })
  phone!: string | null;

  @ApiProperty({ nullable: true, required: false })
  businessName!: string | null;

  @ApiProperty({ enum: LeadIntent, enumName: 'LeadIntent' })
  intent!: LeadIntent;

  @ApiProperty({ nullable: true, required: false })
  message!: string | null;

  @ApiProperty({ enum: LeadStatus, enumName: 'LeadStatus' })
  status!: LeadStatus;

  @ApiProperty()
  createdAt!: string;
}

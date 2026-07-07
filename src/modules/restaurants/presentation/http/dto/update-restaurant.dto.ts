import { ApiPropertyOptional } from '@nestjs/swagger';
import { RestaurantStatus } from '@prisma/client';
import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class UpdateRestaurantDto {
  @ApiPropertyOptional({ example: 'Sazono Bistro' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Razon social. Envia null para limpiar el valor.',
    example: 'Sazono Bistro SpA',
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  legalName?: string | null;

  @ApiPropertyOptional({ example: 'es' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  defaultLanguage?: string;

  @ApiPropertyOptional({ example: 'America/Santiago' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  timezone?: string;

  @ApiPropertyOptional({ example: 'CLP' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  currency?: string;

  @ApiPropertyOptional({ enum: RestaurantStatus, enumName: 'RestaurantStatus' })
  @IsOptional()
  @IsEnum(RestaurantStatus)
  status?: RestaurantStatus;
}

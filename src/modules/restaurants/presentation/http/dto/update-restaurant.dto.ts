import { ApiPropertyOptional } from '@nestjs/swagger';
import { RestaurantStatus } from '@prisma/client';
import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Min,
} from 'class-validator';

export class UpdateRestaurantDto {
  @ApiPropertyOptional({ example: 'Sazono Bistro' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  @ApiPropertyOptional({
    example: 'sazono-bistro',
    description:
      'Identificador de la pantalla de login exclusiva de este restaurante (/r/:slug/login). Solo minusculas, numeros y guiones.',
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @Matches(/^[a-z0-9]+(-[a-z0-9]+)*$/, {
    message: 'slug solo puede contener minusculas, numeros y guiones.',
  })
  slug?: string;

  @ApiPropertyOptional({
    example: 2,
    description: 'Cantidad de sucursales que este restaurante puede crear.',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  branchQuota?: number;

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

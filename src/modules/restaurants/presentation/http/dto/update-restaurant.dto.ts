import { ApiPropertyOptional } from '@nestjs/swagger';
import { RestaurantStatus } from '@prisma/client';
import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
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

  @ApiPropertyOptional({
    nullable: true,
    description:
      'RUT del contribuyente (se valida el digito verificador y se guarda como 12.345.678-5). Envia null para limpiar.',
    example: '76.086.428-5',
  })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  taxId?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Giro comercial. Envia null para limpiar.',
    example: 'Restaurantes y servicios moviles de comida',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  businessActivity?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Direccion legal (casa matriz). Envia null para limpiar.',
    example: 'Av. Providencia 1234, Providencia, Santiago',
  })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  legalAddress?: string | null;

  @ApiPropertyOptional({ nullable: true, example: 'Providencia' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  legalCommune?: string | null;

  @ApiPropertyOptional({ nullable: true, example: 'Santiago' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  legalCity?: string | null;

  @ApiPropertyOptional({ nullable: true, example: 561000 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(999999)
  economicActivityCode?: number | null;

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

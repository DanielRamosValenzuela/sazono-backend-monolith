import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEmail,
  IsInt,
  IsOptional,
  IsString,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

class RestaurantBootstrapInputDto {
  @ApiProperty({ example: 'Sazono Demo Providencia' })
  @IsString()
  name!: string;

  @ApiProperty({ example: 'Sazono Demo SpA', required: false })
  @IsOptional()
  @IsString()
  legalName?: string;

  @ApiProperty({ example: 'es' })
  @IsString()
  defaultLanguage = 'es';

  @ApiProperty({ example: 'America/Santiago' })
  @IsString()
  timezone = 'America/Santiago';

  @ApiProperty({ example: 'CLP' })
  @IsString()
  currency = 'CLP';

  @ApiProperty({
    example: 1,
    required: false,
    description:
      'Cantidad de sucursales que este restaurante puede crear (segun lo acordado en el onboarding). Por defecto 1.',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  branchQuota?: number;
}

class FirstAdminBootstrapInputDto {
  @ApiProperty({ example: 'admin@sazonodemo.cl' })
  @IsEmail()
  email!: string;

  @ApiProperty({ example: 'Sazono1234!' })
  @IsString()
  @MinLength(8)
  password!: string;

  @ApiProperty({ example: 'Daniel' })
  @IsString()
  firstName!: string;

  @ApiProperty({ example: 'Perez' })
  @IsString()
  lastName!: string;
}

export class BootstrapRestaurantDto {
  @ApiProperty({ type: RestaurantBootstrapInputDto })
  @ValidateNested()
  @Type(() => RestaurantBootstrapInputDto)
  restaurant!: RestaurantBootstrapInputDto;

  @ApiProperty({ type: FirstAdminBootstrapInputDto })
  @ValidateNested()
  @Type(() => FirstAdminBootstrapInputDto)
  admin!: FirstAdminBootstrapInputDto;
}

class BootstrapRestaurantFirstAdminResponseDto {
  @ApiProperty({ format: 'uuid' })
  authUserId!: string;

  @ApiProperty({ format: 'uuid' })
  staffUserId!: string;

  @ApiProperty()
  email!: string;

  @ApiProperty()
  firstName!: string;

  @ApiProperty()
  lastName!: string;
}

export class BootstrapRestaurantResponseDto {
  @ApiProperty({ format: 'uuid' })
  restaurantId!: string;

  @ApiProperty()
  restaurantName!: string;

  @ApiProperty({
    example: 'sazono-demo-providencia',
    description:
      'Identificador de la pantalla de login exclusiva de este restaurante (/r/:slug/login).',
  })
  restaurantSlug!: string;

  @ApiProperty({ example: 1 })
  branchQuota!: number;

  @ApiProperty({ type: BootstrapRestaurantFirstAdminResponseDto })
  firstAdmin!: BootstrapRestaurantFirstAdminResponseDto;
}

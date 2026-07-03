import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEmail,
  IsOptional,
  IsString,
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

  @ApiProperty({ type: BootstrapRestaurantFirstAdminResponseDto })
  firstAdmin!: BootstrapRestaurantFirstAdminResponseDto;
}

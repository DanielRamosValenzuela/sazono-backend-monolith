import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, type TransformFnParams } from 'class-transformer';
import {
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MinLength,
} from 'class-validator';

export enum LoginProfileType {
  PLATFORM_ADMIN = 'platform_admin',
  STAFF = 'staff',
}

export class LoginDto {
  @ApiProperty({
    example: 'admin@sazono.cl',
  })
  @Transform(({ value }: TransformFnParams) =>
    typeof value === 'string' ? value.trim().toLowerCase() : undefined,
  )
  @IsEmail()
  email!: string;

  @ApiProperty({
    example: 'super-secret-password',
  })
  @IsString()
  @MinLength(8)
  password!: string;

  @ApiPropertyOptional({
    enum: LoginProfileType,
    description:
      'Selecciona el tipo de perfil si la identidad base puede entrar como staff o como administrador de plataforma.',
  })
  @IsOptional()
  @IsEnum(LoginProfileType)
  profileType?: LoginProfileType;

  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'Selecciona el restaurante cuando la misma identidad tenga mas de un perfil staff.',
  })
  @IsOptional()
  @IsUUID()
  restaurantId?: string;
}

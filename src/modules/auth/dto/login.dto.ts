import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, type TransformFnParams } from 'class-transformer';
import {
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
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
    example: 'sazono-bistro',
    description:
      'Slug del restaurante (identifica la pantalla de login exclusiva de esa empresa). Requerido para profileType=staff.',
  })
  @IsOptional()
  @IsString()
  restaurantSlug?: string;
}

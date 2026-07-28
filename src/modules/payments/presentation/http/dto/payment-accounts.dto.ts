import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaymentAccountStatus, PaymentGatewayProvider } from '@prisma/client';
import { IsIn, IsOptional, IsString, Length } from 'class-validator';

export class ConnectTransbankAccountDto {
  @ApiProperty({
    example: '597055555536',
    description:
      'Codigo de comercio hijo (tienda) que Transbank asigno a este restaurante dentro del Mall de Sazono.',
  })
  @IsString()
  @Length(1, 12)
  childCommerceCode!: string;

  @ApiPropertyOptional({
    enum: ['integration', 'production'],
    description:
      'Si se omite, se usa TRANSBANK_ENVIRONMENT del backend (integration por defecto).',
  })
  @IsOptional()
  @IsIn(['integration', 'production'])
  environment?: 'integration' | 'production';
}

export class MercadoPagoAuthorizationUrlResponseDto {
  @ApiProperty({
    description:
      'URL a la que se debe redirigir al staff ADMIN para autorizar la conexion en Mercado Pago.',
  })
  authorizationUrl!: string;

  @ApiProperty({
    description:
      'Valor opaco de proteccion CSRF, igual al que Mercado Pago devuelve en el callback.',
  })
  state!: string;

  @ApiProperty()
  expiresAt!: string;
}

export class PaymentAccountStatusResponseDto {
  @ApiProperty({
    enum: PaymentGatewayProvider,
    enumName: 'PaymentGatewayProvider',
  })
  provider!: PaymentGatewayProvider;

  @ApiProperty({
    enum: PaymentAccountStatus,
    enumName: 'PaymentAccountStatus',
  })
  status!: PaymentAccountStatus;

  @ApiProperty({ example: 'sandbox' })
  environment!: string;

  @ApiProperty({
    description:
      'Prioridad de visualizacion frente a otras pasarelas del mismo restaurante. Mayor valor = se muestra primero.',
  })
  displayPriority!: number;

  @ApiPropertyOptional({ nullable: true })
  externalAccountId!: string | null;

  @ApiPropertyOptional({ nullable: true })
  publicKey!: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Codigo de comercio hijo de Transbank Webpay Mall.',
  })
  childCommerceCode!: string | null;

  @ApiProperty()
  liveMode!: boolean;

  @ApiPropertyOptional({ nullable: true })
  scope!: string | null;

  @ApiPropertyOptional({ nullable: true })
  connectedAt!: string | null;

  @ApiPropertyOptional({ nullable: true })
  accessTokenExpiresAt!: string | null;

  @ApiPropertyOptional({ nullable: true })
  lastErrorMessage!: string | null;
}

export class TransbankReturnDto {
  @ApiPropertyOptional({
    description:
      'Presente cuando Transbank confirma que el cliente completo el pago.',
  })
  @IsOptional()
  @IsString()
  token_ws?: string;

  @ApiPropertyOptional({
    description:
      'Presente sin token_ws cuando el cliente cancela el pago en Transbank.',
  })
  @IsOptional()
  @IsString()
  TBK_TOKEN?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  TBK_ORDEN_COMPRA?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  TBK_ID_SESION?: string;
}

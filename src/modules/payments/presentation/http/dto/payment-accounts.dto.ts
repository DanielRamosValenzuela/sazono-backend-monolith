import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaymentAccountStatus, PaymentGatewayProvider } from '@prisma/client';

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

  @ApiPropertyOptional({ nullable: true })
  externalAccountId!: string | null;

  @ApiPropertyOptional({ nullable: true })
  publicKey!: string | null;

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

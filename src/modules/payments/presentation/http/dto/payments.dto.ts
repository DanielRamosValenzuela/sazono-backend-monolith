import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  BillSplitMode,
  BillSplitParticipantStatus,
  BillSplitStatus,
  BillStatus,
  OrderStatus,
  PaymentAttemptStatus,
  PaymentGatewayProvider,
  PaymentStatus,
} from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEmail,
  IsEnum,
  IsInt,
  IsNumberString,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class PayQrOrderDto {
  @ApiPropertyOptional({
    example: '1000',
    description: 'Propina opcional que se suma al total de la cuenta.',
  })
  @IsOptional()
  @IsNumberString()
  tipAmount?: string;

  @ApiPropertyOptional({
    description:
      'Token de tarjeta generado por MercadoPago.js en el navegador. Si se envia, se intenta cobrar de verdad con la pasarela conectada del restaurante.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  cardToken?: string;

  @ApiPropertyOptional({ example: 'visa' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  paymentMethodId?: string;

  @ApiPropertyOptional({
    description: 'Identificador del banco emisor de la tarjeta.',
  })
  @IsOptional()
  @IsNumberString()
  issuerId?: string;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(24)
  installments?: number;

  @ApiPropertyOptional({ example: 'cliente@correo.cl' })
  @IsOptional()
  @IsEmail()
  @MaxLength(160)
  payerEmail?: string;
}

export class PayBillDto {
  @ApiProperty({
    example: '11800',
    description: 'Monto a pagar contra el saldo pendiente de la cuenta.',
  })
  @IsNumberString()
  amount!: string;

  @ApiPropertyOptional({
    example: '1000',
    description: 'Propina opcional que se suma al total de la cuenta.',
  })
  @IsOptional()
  @IsNumberString()
  tipAmount?: string;
}

export class PayQrBillDto extends PayBillDto {
  @ApiPropertyOptional({
    description:
      'Token de tarjeta generado por MercadoPago.js en el navegador. Si se envia, se intenta cobrar de verdad con la pasarela conectada del restaurante.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  cardToken?: string;

  @ApiPropertyOptional({ example: 'visa' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  paymentMethodId?: string;

  @ApiPropertyOptional({
    description: 'Identificador del banco emisor de la tarjeta.',
  })
  @IsOptional()
  @IsNumberString()
  issuerId?: string;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(24)
  installments?: number;

  @ApiPropertyOptional({ example: 'cliente@correo.cl' })
  @IsOptional()
  @IsEmail()
  @MaxLength(160)
  payerEmail?: string;
}

export class BillSummaryResponseDto {
  @ApiProperty({ format: 'uuid' })
  billId!: string;

  @ApiProperty({ enum: BillStatus, enumName: 'BillStatus' })
  status!: BillStatus;

  @ApiProperty({ example: '23600' })
  subtotalAmount!: string;

  @ApiProperty({ example: '1000' })
  tipAmount!: string;

  @ApiProperty({ example: '24600' })
  totalAmount!: string;

  @ApiProperty({ example: '0' })
  remainingAmount!: string;
}

class PaidOrderSummaryResponseDto {
  @ApiProperty({ format: 'uuid' })
  orderId!: string;

  @ApiProperty({ enum: OrderStatus, enumName: 'OrderStatus' })
  status!: OrderStatus;
}

export class PaymentResultResponseDto {
  @ApiProperty({ format: 'uuid' })
  paymentId!: string;

  @ApiProperty({ format: 'uuid' })
  billId!: string;

  @ApiProperty({ example: '12800' })
  amount!: string;

  @ApiProperty({ example: 'CLP' })
  currency!: string;

  @ApiProperty({ example: 'MANUAL' })
  provider!: string;

  @ApiProperty({ nullable: true, required: false })
  providerReference!: string | null;

  @ApiProperty({ enum: PaymentStatus, enumName: 'PaymentStatus' })
  status!: PaymentStatus;

  @ApiProperty({ nullable: true, required: false })
  paidAt!: string | null;

  @ApiProperty({ type: BillSummaryResponseDto })
  bill!: BillSummaryResponseDto;

  @ApiProperty({
    type: PaidOrderSummaryResponseDto,
    nullable: true,
    required: false,
  })
  order!: PaidOrderSummaryResponseDto | null;
}

export class CreateBillSplitParticipantDto {
  @ApiPropertyOptional({ example: 'Ana' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  displayName?: string;

  @ApiProperty({
    example: '11800',
    description: 'Parte del saldo pendiente asignada a este participante.',
  })
  @IsNumberString()
  amount!: string;
}

export class CreateBillSplitDto {
  @ApiProperty({ type: [CreateBillSplitParticipantDto] })
  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => CreateBillSplitParticipantDto)
  participants!: CreateBillSplitParticipantDto[];
}

export class PayBillSplitParticipantDto {
  @ApiPropertyOptional({
    example: '1000',
    description: 'Propina opcional que se suma al total de la cuenta.',
  })
  @IsOptional()
  @IsNumberString()
  tipAmount?: string;

  @ApiPropertyOptional({
    description:
      'Token de tarjeta generado por MercadoPago.js en el navegador. Si se envia, se intenta cobrar de verdad con la pasarela conectada del restaurante.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  cardToken?: string;

  @ApiPropertyOptional({ example: 'visa' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  paymentMethodId?: string;

  @ApiPropertyOptional({
    description: 'Identificador del banco emisor de la tarjeta.',
  })
  @IsOptional()
  @IsNumberString()
  issuerId?: string;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(24)
  installments?: number;

  @ApiPropertyOptional({ example: 'cliente@correo.cl' })
  @IsOptional()
  @IsEmail()
  @MaxLength(160)
  payerEmail?: string;
}

class BillSplitParticipantResponseDto {
  @ApiProperty({ format: 'uuid' })
  participantId!: string;

  @ApiProperty({
    description: 'Token con el que el participante paga su parte desde QR.',
  })
  participantToken!: string;

  @ApiProperty({ nullable: true, required: false })
  displayName!: string | null;

  @ApiProperty({ example: '11800' })
  allocatedAmount!: string;

  @ApiProperty({ example: '0' })
  paidAmount!: string;

  @ApiProperty({
    enum: BillSplitParticipantStatus,
    enumName: 'BillSplitParticipantStatus',
  })
  status!: BillSplitParticipantStatus;
}

export class BillSplitParticipantDetailResponseDto {
  @ApiProperty({ format: 'uuid' })
  participantId!: string;

  @ApiProperty({ nullable: true, required: false })
  displayName!: string | null;

  @ApiProperty({ example: '11800' })
  allocatedAmount!: string;

  @ApiProperty({ example: '0' })
  paidAmount!: string;

  @ApiProperty({
    enum: BillSplitParticipantStatus,
    enumName: 'BillSplitParticipantStatus',
  })
  status!: BillSplitParticipantStatus;

  @ApiProperty({ example: 'CLP' })
  currency!: string;

  @ApiProperty({ enum: BillStatus, enumName: 'BillStatus' })
  billStatus!: BillStatus;

  @ApiProperty({
    description:
      'Si es false no hay ninguna pasarela conectada y el participante solo puede pagar de forma manual.',
  })
  gatewayConnected!: boolean;

  @ApiPropertyOptional({
    enum: PaymentGatewayProvider,
    enumName: 'PaymentGatewayProvider',
  })
  provider?: PaymentGatewayProvider;

  @ApiPropertyOptional({
    description:
      'Llave publica de la pasarela, segura para usar en el navegador.',
  })
  publicKey?: string;

  @ApiPropertyOptional({ example: 'sandbox' })
  environment?: string;
}

export class BillSplitResponseDto {
  @ApiProperty({ format: 'uuid' })
  billSplitId!: string;

  @ApiProperty({ format: 'uuid' })
  billId!: string;

  @ApiProperty({ enum: BillSplitMode, enumName: 'BillSplitMode' })
  splitMode!: BillSplitMode;

  @ApiProperty({ enum: BillSplitStatus, enumName: 'BillSplitStatus' })
  status!: BillSplitStatus;

  @ApiProperty({ type: [BillSplitParticipantResponseDto] })
  participants!: BillSplitParticipantResponseDto[];
}

export class PaymentSummaryResponseDto {
  @ApiProperty({ format: 'uuid' })
  paymentId!: string;

  @ApiProperty({ format: 'uuid' })
  billId!: string;

  @ApiProperty({ example: '12800' })
  amount!: string;

  @ApiProperty({ example: 'CLP' })
  currency!: string;

  @ApiProperty({ example: 'MANUAL' })
  provider!: string;

  @ApiProperty({ nullable: true, required: false })
  providerReference!: string | null;

  @ApiProperty({ enum: PaymentStatus, enumName: 'PaymentStatus' })
  status!: PaymentStatus;

  @ApiProperty({ nullable: true, required: false })
  paidAt!: string | null;

  @ApiProperty()
  createdAt!: string;
}

export class QrOrderPaymentStatusResponseDto {
  @ApiProperty({ format: 'uuid' })
  orderId!: string;

  @ApiProperty({ enum: OrderStatus, enumName: 'OrderStatus' })
  orderStatus!: OrderStatus;

  @ApiProperty({
    enum: PaymentAttemptStatus,
    enumName: 'PaymentAttemptStatus',
    nullable: true,
    required: false,
  })
  attemptStatus!: PaymentAttemptStatus | null;

  @ApiProperty({
    enum: PaymentStatus,
    enumName: 'PaymentStatus',
    nullable: true,
    required: false,
  })
  paymentStatus!: PaymentStatus | null;

  @ApiProperty({ nullable: true, required: false })
  providerReference!: string | null;

  @ApiProperty({ nullable: true, required: false })
  failureReason!: string | null;

  @ApiProperty()
  updatedAt!: string;
}

export class QrPaymentConfigOptionResponseDto {
  @ApiProperty({
    enum: PaymentGatewayProvider,
    enumName: 'PaymentGatewayProvider',
  })
  provider!: PaymentGatewayProvider;

  @ApiProperty({
    enum: ['embedded', 'redirect'],
    description:
      'embedded: se cobra con un SDK en el navegador. redirect: hay que enviar al cliente a una URL externa.',
  })
  checkoutMode!: 'embedded' | 'redirect';

  @ApiPropertyOptional({
    description:
      'Llave publica de la pasarela, segura para usar en el navegador. Solo aplica a pasarelas embedded.',
  })
  publicKey?: string;

  @ApiProperty({ example: 'sandbox' })
  environment!: string;

  @ApiProperty({
    description:
      'true para la opcion de mayor prioridad de visualizacion del restaurante.',
  })
  isPreferred!: boolean;
}

export class QrPaymentConfigResponseDto {
  @ApiProperty({
    type: [QrPaymentConfigOptionResponseDto],
    description:
      'Pasarelas conectadas y disponibles para pagar, ordenadas por prioridad. Vacio si el pago QR solo puede registrarse manualmente.',
  })
  options!: QrPaymentConfigOptionResponseDto[];
}

export class StartRedirectOrderPaymentDto {
  @ApiProperty({
    enum: PaymentGatewayProvider,
    enumName: 'PaymentGatewayProvider',
    description:
      'Pasarela de redireccion elegida por el cliente entre las que devuelve GET .../payment-config.',
  })
  @IsEnum(PaymentGatewayProvider)
  provider!: PaymentGatewayProvider;

  @ApiPropertyOptional({
    example: '1000',
    description: 'Propina opcional que se suma al total de la orden.',
  })
  @IsOptional()
  @IsNumberString()
  tipAmount?: string;
}

export class StartRedirectBillPaymentDto {
  @ApiProperty({
    enum: PaymentGatewayProvider,
    enumName: 'PaymentGatewayProvider',
    description:
      'Pasarela de redireccion elegida por el cliente entre las que devuelve GET .../payment-config.',
  })
  @IsEnum(PaymentGatewayProvider)
  provider!: PaymentGatewayProvider;

  @ApiProperty({
    example: '11800',
    description: 'Monto a pagar contra el saldo pendiente de la cuenta.',
  })
  @IsNumberString()
  amount!: string;

  @ApiPropertyOptional({
    example: '1000',
    description: 'Propina opcional que se suma al total de la cuenta.',
  })
  @IsOptional()
  @IsNumberString()
  tipAmount?: string;
}

export class StartRedirectSplitParticipantPaymentDto {
  @ApiProperty({
    enum: PaymentGatewayProvider,
    enumName: 'PaymentGatewayProvider',
    description:
      'Pasarela de redireccion elegida por el cliente entre las que devuelve GET .../payment-config.',
  })
  @IsEnum(PaymentGatewayProvider)
  provider!: PaymentGatewayProvider;

  @ApiPropertyOptional({
    example: '1000',
    description: 'Propina opcional que se suma al total de la cuenta.',
  })
  @IsOptional()
  @IsNumberString()
  tipAmount?: string;
}

export class RedirectPaymentResponseDto {
  @ApiProperty({ format: 'uuid' })
  attemptId!: string;

  @ApiProperty({
    enum: PaymentGatewayProvider,
    enumName: 'PaymentGatewayProvider',
  })
  provider!: PaymentGatewayProvider;

  @ApiProperty({
    description: 'URL de la pasarela a la que hay que enviar el form-POST.',
  })
  redirectUrl!: string;

  @ApiProperty({ enum: ['POST'] })
  method!: 'POST';

  @ApiProperty({
    type: Object,
    description: 'Campos que hay que enviar en el form-POST de redireccion.',
  })
  fields!: Record<string, string>;

  @ApiProperty({
    description: 'Momento en que expira la sesion de pago de la pasarela.',
  })
  expiresAt!: string;
}

export class ConfirmRedirectPaymentResponseDto {
  @ApiProperty({ enum: ['APPROVED', 'REJECTED', 'ABORTED', 'TIMEOUT'] })
  status!: 'APPROVED' | 'REJECTED' | 'ABORTED' | 'TIMEOUT';

  @ApiPropertyOptional({ type: PaymentResultResponseDto, nullable: true })
  payment!: PaymentResultResponseDto | null;

  @ApiPropertyOptional({ nullable: true })
  failureReason?: string;
}

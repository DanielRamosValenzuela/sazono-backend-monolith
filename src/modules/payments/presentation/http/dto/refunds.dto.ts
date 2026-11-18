import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  PaymentMethod,
  PaymentStatus,
  RefundMethod,
  RefundReason,
  RefundStatus,
  Role,
} from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsUUID,
  Length,
  Matches,
  ValidateIf,
} from 'class-validator';

export const REFUND_MONEY_PATTERN = /^(0|[1-9]\d{0,9})$/;
const NO_CONTROL_CHARS_PATTERN = /^[^\p{Cc}]*$/u;
const THREE_VISIBLE_CHARS_PATTERN =
  /(?:[^\s\u200B-\u200D\u2060\uFEFF][\s\S]*?){3}/;
const PIN_PATTERN = /^\d{4,6}$/;

const isPresent = (value: unknown) => value !== undefined && value !== null;

export class CreateRefundDto {
  @ApiProperty({
    example: '3000',
    description:
      'Total devuelto al cliente en pesos enteros (CLP), incluida la propina que se devuelva.',
  })
  @Matches(REFUND_MONEY_PATTERN, {
    message: 'El monto debe ser un numero entero de pesos.',
  })
  amount!: string;

  @ApiProperty({ enum: RefundReason })
  @IsEnum(RefundReason)
  reasonCode!: RefundReason;

  @ApiProperty({ example: 'Plato frio' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @Length(3, 500, {
    message: 'El motivo es obligatorio (minimo 3 caracteres).',
  })
  @Matches(THREE_VISIBLE_CHARS_PATTERN, {
    message: 'El motivo es obligatorio (minimo 3 caracteres visibles).',
  })
  @Matches(NO_CONTROL_CHARS_PATTERN, {
    message: 'El motivo no puede contener caracteres de control.',
  })
  reasonText!: string;

  @ApiPropertyOptional({
    description:
      'Si se omite se usa branch_settings.refund_tip_default de la sucursal.',
  })
  @IsOptional()
  @Transform(({ obj }: { obj: Record<string, unknown> }) => obj.refundTip)
  @IsBoolean()
  refundTip?: boolean;

  @ApiPropertyOptional({
    example: '500',
    description:
      'Propina incluida en amount. Solo con refundTip = true. Si se omite se calcula proporcional.',
  })
  @IsOptional()
  @Matches(REFUND_MONEY_PATTERN, {
    message: 'La propina debe ser un numero entero de pesos.',
  })
  tipAmount?: string;

  @ApiPropertyOptional({
    description:
      'Solo ADMIN. En pagos de pasarela registra el reembolso como hecho fuera de Sazono (sin llamar a la pasarela).',
  })
  @IsOptional()
  @IsBoolean()
  registerAsManual?: boolean;

  @ApiPropertyOptional({ format: 'uuid' })
  @ValidateIf((dto: CreateRefundDto) => isPresent(dto.approverPin))
  @IsUUID()
  approverStaffUserId?: string;

  @ApiPropertyOptional({ example: '1234' })
  @ValidateIf((dto: CreateRefundDto) => isPresent(dto.approverStaffUserId))
  @Matches(PIN_PATTERN, { message: 'El PIN debe tener entre 4 y 6 digitos.' })
  approverPin?: string;
}

export type RefundRequesterDto = {
  staffUserId: string;
  name: string;
  role: Role | null;
};

export type RefundApproverDto = {
  staffUserId: string;
  name: string;
};

export type RefundResponseDto = {
  refundId: string;
  paymentId: string;
  billId: string;
  amount: string;
  tipAmount: string;
  consumptionAmount: string;
  netAmount: string;
  vatAmount: string;
  status: RefundStatus;
  method: RefundMethod;
  reasonCode: RefundReason;
  reasonText: string;
  failureReason: string | null;
  requestedBy: RefundRequesterDto | null;
  approvedBy: RefundApproverDto | null;
  creditNoteStatus: string;
  completedAt: string | null;
  createdAt: string;
};

export type RefundablePaymentDto = {
  total: string;
  consumption: string;
  tip: string;
};

export type RefundPaymentStateDto = {
  paymentId: string;
  amount: string;
  tipAmount: string;
  refundedAmount: string;
  refundedTipAmount: string;
  refundable: RefundablePaymentDto;
};

export type RefundResultResponseDto = {
  refund: RefundResponseDto;
  payment: RefundPaymentStateDto;
  cashToHandOver: string | null;
  billActiveOrders: number;
  idempotentReplay: boolean;
};

export type PaymentRefundsResponseDto = {
  payment: RefundPaymentStateDto & {
    billId: string;
    method: PaymentMethod | null;
    provider: string;
    status: PaymentStatus;
    consumptionAmount: string;
    paidAt: string | null;
    disputed: boolean;
    installments: number | null;
    gatewayRefundSupported: boolean;
  };
  settings: {
    cashierRefundLimit: string | null;
    refundTipDefault: boolean;
  };
  eligibility: {
    allowed: boolean;
    method: RefundMethod | null;
    deniedCode: string | null;
    deniedMessage: string | null;
    canManageGateway: boolean;
  };
  refunds: RefundResponseDto[];
};

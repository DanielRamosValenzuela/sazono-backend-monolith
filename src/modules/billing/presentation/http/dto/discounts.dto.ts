import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BillStatus, DiscountReason, DiscountType, Role } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsOptional,
  IsUUID,
  Length,
  Matches,
  ValidateIf,
} from 'class-validator';

export const DISCOUNT_VALUE_PATTERN = /^(0|[1-9]\d{0,9})(\.\d{1,2})?$/;
const NO_CONTROL_CHARS_PATTERN = /^[^\p{Cc}]*$/u;
const THREE_VISIBLE_CHARS_PATTERN =
  /(?:[^\s\u200B-\u200D\u2060\uFEFF][\s\S]*?){3}/;
const PIN_PATTERN = /^\d{4,6}$/;

const isPresent = (value: unknown) => value !== undefined && value !== null;

const trimString = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class CreateBillDiscountDto {
  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Si se omite el descuento es de toda la cuenta.',
  })
  @IsOptional()
  @IsUUID()
  billItemId?: string;

  @ApiProperty({ enum: DiscountType })
  @IsEnum(DiscountType)
  type!: DiscountType;

  @ApiProperty({
    example: '10',
    description: 'PERCENT: 0 < v <= 100. AMOUNT: pesos enteros > 0.',
  })
  @Matches(DISCOUNT_VALUE_PATTERN, {
    message: 'El valor del descuento no es valido.',
  })
  value!: string;

  @ApiProperty({ enum: DiscountReason })
  @IsEnum(DiscountReason)
  reasonCode!: DiscountReason;

  @ApiProperty({ example: 'Cliente espero mas de lo normal' })
  @Transform(trimString)
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

  @ApiPropertyOptional({ format: 'uuid' })
  @ValidateIf((dto: CreateBillDiscountDto) => isPresent(dto.approverPin))
  @IsUUID()
  approverStaffUserId?: string;

  @ApiPropertyOptional({ example: '1234' })
  @ValidateIf((dto: CreateBillDiscountDto) =>
    isPresent(dto.approverStaffUserId),
  )
  @Matches(PIN_PATTERN, { message: 'El PIN debe tener entre 4 y 6 digitos.' })
  approverPin?: string;
}

export class VoidBillDiscountDto {
  @ApiProperty({ example: 'Aplicado por error' })
  @Transform(trimString)
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
}

export type DiscountBillTotalsDto = {
  billId: string;
  status: BillStatus;
  subtotalAmount: string;
  discountAmount: string;
  consumptionAmount: string;
  tipAmount: string;
  totalAmount: string;
  paidAmount: string;
  remainingAmount: string;
};

export type BillDiscountDto = {
  id: string;
  billId: string;
  billItemId: string | null;
  billItemDescription: string | null;
  type: DiscountType;
  value: string;
  amount: string;
  reasonCode: DiscountReason;
  reasonText: string;
  appliedByStaffUserId: string;
  appliedByName: string;
  appliedByRole: Role;
  approvedByStaffUserId: string | null;
  approvedByName: string | null;
  voidedAt: string | null;
  voidedByStaffUserId: string | null;
  voidedByName: string | null;
  voidReason: string | null;
  createdAt: string;
};

export type BillDiscountResultDto = {
  discount: BillDiscountDto;
  bill: DiscountBillTotalsDto;
  splitCancelled: boolean;
  idempotentReplay: boolean;
};

export type VoidBillDiscountResultDto = {
  discount: BillDiscountDto;
  bill: DiscountBillTotalsDto;
  splitCancelled: boolean;
};

export type DiscountPreviewDto = {
  bill: DiscountBillTotalsDto;
  newDiscountAmount: string;
  needsApproval: boolean;
  maxDiscount: string;
  approvers: Array<{ staffUserId: string; name: string }>;
};

export type DiscountBillItemDto = {
  billItemId: string;
  description: string;
  quantity: number;
  totalPrice: string;
  discountAmount: string;
};

export type BillDiscountListDto = {
  bill: DiscountBillTotalsDto;
  items: DiscountBillItemDto[];
  discounts: BillDiscountDto[];
  needsApprovalAbovePercent: string | null;
  needsApprovalAboveAmount: string | null;
};

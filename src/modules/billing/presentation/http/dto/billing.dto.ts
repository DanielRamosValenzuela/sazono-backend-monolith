import { ApiProperty } from '@nestjs/swagger';
import { BillStatus } from '@prisma/client';

export class BillResponseDto {
  @ApiProperty({ format: 'uuid' })
  billId!: string;

  @ApiProperty({ format: 'uuid' })
  tableSessionId!: string;

  @ApiProperty({ format: 'uuid' })
  branchId!: string;

  @ApiProperty({ enum: BillStatus, enumName: 'BillStatus' })
  status!: BillStatus;

  @ApiProperty({ example: '0' })
  subtotalAmount!: string;

  @ApiProperty({ example: '0' })
  taxAmount!: string;

  @ApiProperty({ example: '0' })
  tipAmount!: string;

  @ApiProperty({ example: '0' })
  totalAmount!: string;

  @ApiProperty({ example: '0' })
  remainingAmount!: string;

  @ApiProperty()
  openedAt!: string;

  @ApiProperty({ nullable: true, required: false })
  closedAt!: string | null;

  @ApiProperty({ nullable: true, required: false })
  closeReason!: string | null;
}

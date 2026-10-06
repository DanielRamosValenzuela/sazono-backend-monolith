import { ApiProperty } from '@nestjs/swagger';
import { BillStatus, TableSessionStatus } from '@prisma/client';

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

export class BranchOpenBillResponseDto {
  @ApiProperty({ format: 'uuid' })
  tableId!: string;

  @ApiProperty({ example: 'M01' })
  tableCode!: string;

  @ApiProperty({ example: false })
  isCounter!: boolean;

  @ApiProperty({ nullable: true, example: 12 })
  ticketNumber!: number | null;

  @ApiProperty({ nullable: true, example: 'Ana' })
  customerLabel!: string | null;

  @ApiProperty()
  tableName!: string;

  @ApiProperty({ format: 'uuid' })
  tableSessionId!: string;

  @ApiProperty({ enum: TableSessionStatus, enumName: 'TableSessionStatus' })
  sessionStatus!: TableSessionStatus;

  @ApiProperty()
  sessionOpenedAt!: string;

  @ApiProperty({ format: 'uuid' })
  billId!: string;

  @ApiProperty({ example: '0' })
  totalAmount!: string;

  @ApiProperty({ example: '0' })
  remainingAmount!: string;
}

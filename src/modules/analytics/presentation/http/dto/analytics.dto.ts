import { ApiProperty } from '@nestjs/swagger';
import { OrderStatus } from '@prisma/client';

export class DailyPaymentsMetricDto {
  @ApiProperty({ example: '2026-07-01' })
  date!: string;

  @ApiProperty({ example: '30000.00' })
  amount!: string;

  @ApiProperty({ example: 6 })
  count!: number;
}

export class OrdersByStatusMetricDto {
  @ApiProperty({ enum: OrderStatus, enumName: 'OrderStatus' })
  status!: OrderStatus;

  @ApiProperty({ example: 3 })
  count!: number;
}

export class TopItemMetricDto {
  @ApiProperty({ example: 'Pizza Margarita' })
  name!: string;

  @ApiProperty({ example: 24 })
  quantity!: number;

  @ApiProperty({ example: '180000.00' })
  amount!: string;
}

export class BranchSummaryResponseDto {
  @ApiProperty({ format: 'uuid' })
  branchId!: string;

  @ApiProperty({ example: 12 })
  totalTables!: number;

  @ApiProperty({ example: 4 })
  occupiedTables!: number;

  @ApiProperty({ example: 4 })
  openSessions!: number;

  @ApiProperty({ example: '45000.00' })
  todayRevenue!: string;

  @ApiProperty({ example: 9 })
  todayPaymentsCount!: number;

  @ApiProperty({ example: '5000.00' })
  averageTicket!: string;

  @ApiProperty({ type: [DailyPaymentsMetricDto] })
  last7Days!: DailyPaymentsMetricDto[];

  @ApiProperty({ type: [OrdersByStatusMetricDto] })
  ordersByStatus!: OrdersByStatusMetricDto[];

  @ApiProperty({ type: [TopItemMetricDto] })
  topItems!: TopItemMetricDto[];
}

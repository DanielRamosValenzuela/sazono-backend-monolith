import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { OrderStatus } from '@prisma/client';
import { IsDateString, IsOptional } from 'class-validator';

export class GetBranchSummaryQueryDto {
  @ApiPropertyOptional({
    example: '2026-07-01',
    description:
      'Inicio del rango (inclusive, YYYY-MM-DD). Si se omite junto con "to", se usan los ultimos 7 dias.',
  })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({
    example: '2026-07-08',
    description:
      'Fin del rango (inclusive, YYYY-MM-DD). Si se omite junto con "from", se usan los ultimos 7 dias.',
  })
  @IsOptional()
  @IsDateString()
  to?: string;
}

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

  @ApiProperty({
    type: [DailyPaymentsMetricDto],
    description:
      'Serie diaria de pagos. Cubre el rango pedido (from/to) o los ultimos 7 dias por defecto.',
  })
  dailySeries!: DailyPaymentsMetricDto[];

  @ApiProperty({ type: [OrdersByStatusMetricDto] })
  ordersByStatus!: OrdersByStatusMetricDto[];

  @ApiProperty({ type: [TopItemMetricDto] })
  topItems!: TopItemMetricDto[];
}

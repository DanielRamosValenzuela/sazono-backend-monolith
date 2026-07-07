import { ApiProperty } from '@nestjs/swagger';

export class PlatformMetricsTotalsDto {
  @ApiProperty({ example: 10 })
  restaurants!: number;

  @ApiProperty({ example: 9 })
  activeRestaurants!: number;

  @ApiProperty({ example: 14 })
  branches!: number;

  @ApiProperty({ example: 80 })
  staffUsers!: number;

  @ApiProperty({ example: '1250000.00' })
  paymentsAmount!: string;

  @ApiProperty({ example: 342 })
  paymentsCount!: number;
}

export class MonthlyPaymentsMetricDto {
  @ApiProperty({ example: '2026-01' })
  month!: string;

  @ApiProperty({ example: '150000.00' })
  amount!: string;

  @ApiProperty({ example: 40 })
  count!: number;
}

export class TopRestaurantMetricDto {
  @ApiProperty({ format: 'uuid' })
  restaurantId!: string;

  @ApiProperty({ example: 'Sazono Bistro' })
  name!: string;

  @ApiProperty({ example: '500000.00' })
  amount!: string;

  @ApiProperty({ example: 120 })
  count!: number;
}

export class PlatformMetricsResponseDto {
  @ApiProperty({ type: PlatformMetricsTotalsDto })
  totals!: PlatformMetricsTotalsDto;

  @ApiProperty({ type: [MonthlyPaymentsMetricDto] })
  monthlyPayments!: MonthlyPaymentsMetricDto[];

  @ApiProperty({ type: [TopRestaurantMetricDto] })
  topRestaurants!: TopRestaurantMetricDto[];
}

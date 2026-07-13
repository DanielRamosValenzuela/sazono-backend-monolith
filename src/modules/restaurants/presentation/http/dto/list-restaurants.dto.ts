import { ApiProperty } from '@nestjs/swagger';
import { RestaurantStatus } from '@prisma/client';

export class RestaurantSummaryResponseDto {
  @ApiProperty({ format: 'uuid' })
  restaurantId!: string;

  @ApiProperty({ example: 'Sazono Bistro' })
  name!: string;

  @ApiProperty({ nullable: true, required: false })
  legalName!: string | null;

  @ApiProperty({ example: 'sazono-bistro' })
  slug!: string;

  @ApiProperty({ example: 1 })
  branchQuota!: number;

  @ApiProperty({ enum: RestaurantStatus, enumName: 'RestaurantStatus' })
  status!: RestaurantStatus;

  @ApiProperty({ example: 'CLP' })
  currency!: string;

  @ApiProperty({ example: 'America/Santiago' })
  timezone!: string;

  @ApiProperty({ example: 'es' })
  defaultLanguage!: string;

  @ApiProperty()
  createdAt!: string;

  @ApiProperty({ example: 2 })
  branchCount!: number;

  @ApiProperty({ example: 5 })
  staffCount!: number;
}

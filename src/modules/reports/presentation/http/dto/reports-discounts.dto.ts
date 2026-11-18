import { ApiPropertyOptional } from '@nestjs/swagger';
import { DiscountReason } from '@prisma/client';
import { IsEnum, IsIn, IsOptional, IsUUID } from 'class-validator';
import { ReportDateRangeDto } from './reports.dto';

export class DiscountsReportQueryDto extends ReportDateRangeDto {
  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'Filtra por quien aplico el descuento. Para CASHIER se ignora y se fuerza su propio id.',
  })
  @IsOptional()
  @IsUUID()
  cashierId?: string;

  @ApiPropertyOptional({ enum: DiscountReason })
  @IsOptional()
  @IsEnum(DiscountReason)
  reasonCode?: DiscountReason;

  @ApiPropertyOptional({ enum: ['true', 'false'] })
  @IsOptional()
  @IsIn(['true', 'false'])
  voided?: string;
}

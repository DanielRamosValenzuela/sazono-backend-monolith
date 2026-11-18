import { ApiPropertyOptional, OmitType, PickType } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import { STAFF_ROLES } from '../../../application/get-sales-by-staff.service';
import { KPI_COMPARES } from '../../../application/get-summary-kpis.service';
import {
  OPEN_TAB_KINDS,
  TIME_BUCKETS,
} from '../../../infrastructure/reports-insights.prisma.repository';
import { ReportCommonFilterDto, SalesByOrderQueryDto } from './reports.dto';

export class InsightsQueryDto extends OmitType(SalesByOrderQueryDto, [
  'orderBy',
  'direction',
  'cursor',
  'limit',
] as const) {}

export class SalesByStaffQueryDto extends InsightsQueryDto {
  @ApiPropertyOptional({
    enum: STAFF_ROLES,
    default: 'waiter',
    description:
      'waiter: atribucion por mesero (asignado, luego quien abrio la mesa, luego quien creo la primera orden). cashier: atribucion por cada pago cobrado. CASHIER solo puede usar cashier.',
  })
  @IsOptional()
  @IsIn(STAFF_ROLES)
  role?: (typeof STAFF_ROLES)[number];
}

export class SalesByTimeQueryDto extends InsightsQueryDto {
  @ApiPropertyOptional({
    enum: TIME_BUCKETS,
    default: 'hour',
    description:
      'Agrupacion en la zona horaria del restaurante. hour y weekday devuelven ademas el mapa de calor 7x24 (lunes primero).',
  })
  @IsOptional()
  @IsIn(TIME_BUCKETS)
  bucket?: (typeof TIME_BUCKETS)[number];
}

export class SummaryKpisQueryDto extends InsightsQueryDto {
  @ApiPropertyOptional({
    enum: KPI_COMPARES,
    description:
      'previous: compara con el rango anterior de igual duracion. Ignorado para CASHIER.',
  })
  @IsOptional()
  @IsIn(KPI_COMPARES)
  compare?: (typeof KPI_COMPARES)[number];
}

export class OpenTabsQueryDto extends PickType(ReportCommonFilterDto, [
  'from',
  'to',
  'waiterId',
  'tableId',
  'zoneId',
] as const) {
  @ApiPropertyOptional({
    enum: OPEN_TAB_KINDS,
    default: 'open',
    description:
      'open: mesas abiertas ahora (from y to se ignoran). abandoned: abandonadas con cierre en el rango. cancelled: con ordenes anuladas en el rango.',
  })
  @IsOptional()
  @IsIn(OPEN_TAB_KINDS)
  kind?: (typeof OPEN_TAB_KINDS)[number];

  @ApiPropertyOptional({ enum: ['json', 'csv'], default: 'json' })
  @IsOptional()
  @IsIn(['json', 'csv'])
  format?: 'json' | 'csv';
}

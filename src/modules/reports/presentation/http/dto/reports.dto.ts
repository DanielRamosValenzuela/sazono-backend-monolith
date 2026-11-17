import { ApiPropertyOptional } from '@nestjs/swagger';
import { PaymentAttemptStatus, PaymentStatus } from '@prisma/client';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  HIERARCHY_GROUPS,
  type HierarchyGroupBy,
} from '../../../application/hierarchy-tree';
import {
  BILL_PAYMENT_STATUSES,
  MAX_FILTER_AMOUNT,
  MAX_PAGE_LIMIT,
  MAX_SEARCH_LENGTH,
  METHOD_KEYS,
  PAYMENTS_ORDER_BY,
  PAYMENT_SOURCES,
  SALES_ORDER_BY,
  SORT_DIRECTIONS,
} from '../../../application/report-types';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const METHOD_LIST_PATTERN = /^[A-Z_]+(,[A-Z_]+)*$/;
const WEEKDAY_LIST_PATTERN = /^[1-7](,[1-7]){0,6}$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const REPORT_STATUSES = [
  ...new Set([
    ...Object.values(PaymentStatus),
    ...Object.values(PaymentAttemptStatus),
  ]),
];

export class ReportDateRangeDto {
  @ApiPropertyOptional({
    example: '2026-11-01',
    description:
      'Inicio del rango (inclusive, YYYY-MM-DD en la zona horaria del restaurante). Obligatorio para ADMIN y SUPERVISOR; para CASHIER se ignora y se fuerza el dia de hoy.',
  })
  @IsOptional()
  @Matches(DATE_PATTERN)
  from?: string;

  @ApiPropertyOptional({
    example: '2026-11-17',
    description:
      'Fin del rango (inclusive, YYYY-MM-DD). Maximo 366 dias (92 para CSV).',
  })
  @IsOptional()
  @Matches(DATE_PATTERN)
  to?: string;
}

export class ReportCommonFilterDto extends ReportDateRangeDto {
  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'Filtra por el usuario staff que cobro. Para CASHIER se ignora y se fuerza su propio id.',
  })
  @IsOptional()
  @IsUUID()
  cashierId?: string;

  @ApiPropertyOptional({
    example: 'CASH,CREDIT_CARD',
    description: `Lista separada por comas de medios de pago. Valores: ${METHOD_KEYS.join(', ')}.`,
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  @Matches(METHOD_LIST_PATTERN)
  method?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Mesero asignado a la sesion de la comanda.',
  })
  @IsOptional()
  @IsUUID()
  waiterId?: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'Mesa de la comanda.' })
  @IsOptional()
  @IsUUID()
  tableId?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Zona de la mesa de la comanda.',
  })
  @IsOptional()
  @IsUUID()
  zoneId?: string;

  @ApiPropertyOptional({
    example: 'WEB_QR,CASHIER',
    description: `Lista separada por comas del origen del pago. Valores: ${PAYMENT_SOURCES.join(', ')}.`,
  })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  @Matches(METHOD_LIST_PATTERN)
  source?: string;

  @ApiPropertyOptional({
    example: '12:00',
    description:
      'Hora del dia inicial (HH:mm, hora del restaurante, inclusiva al minuto). Si es mayor que timeTo el rango cruza la medianoche.',
  })
  @IsOptional()
  @Matches(TIME_PATTERN)
  timeFrom?: string;

  @ApiPropertyOptional({
    example: '15:30',
    description:
      'Hora del dia final (HH:mm, hora del restaurante, inclusiva al minuto).',
  })
  @IsOptional()
  @Matches(TIME_PATTERN)
  timeTo?: string;

  @ApiPropertyOptional({
    example: '5,6,7',
    description:
      'Dias de la semana ISO separados por comas: 1 lunes a 7 domingo.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(13)
  @Matches(WEEKDAY_LIST_PATTERN)
  weekdays?: string;
}

export class ReportRangeQueryDto extends ReportCommonFilterDto {
  @ApiPropertyOptional({
    description: `Busqueda libre sin distinguir mayusculas: numero de comanda, mesa, cliente, cajero o mesero (en pagos tambien la referencia). Maximo ${MAX_SEARCH_LENGTH} caracteres; % y _ se tratan como texto.`,
  })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_SEARCH_LENGTH * 2)
  q?: string;

  @ApiPropertyOptional({
    enum: ['true', 'false'],
    description: 'true: solo con propina. false: solo sin propina.',
  })
  @IsOptional()
  @IsIn(['true', 'false'])
  hasTip?: 'true' | 'false';

  @ApiPropertyOptional({
    example: 1000,
    description: 'Propina minima en pesos (entero).',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_FILTER_AMOUNT)
  minTip?: number;

  @ApiPropertyOptional({
    description: 'Cursor opaco devuelto en nextCursor de la pagina anterior.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  cursor?: string;

  @ApiPropertyOptional({ example: 50, minimum: 1, maximum: MAX_PAGE_LIMIT })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_LIMIT)
  limit?: number;

  @ApiPropertyOptional({ enum: ['json', 'csv'], default: 'json' })
  @IsOptional()
  @IsIn(['json', 'csv'])
  format?: 'json' | 'csv';
}

export class SalesByOrderQueryDto extends ReportRangeQueryDto {
  @ApiPropertyOptional({
    example: 'PAID_FULL,MIXED',
    description: `Estado de pago de la comanda (Pagado = PAID_FULL, Mixto = MIXED). Valores: ${BILL_PAYMENT_STATUSES.join(', ')}.`,
  })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  @Matches(METHOD_LIST_PATTERN)
  status?: string;

  @ApiPropertyOptional({
    example: 5000,
    description: 'Total minimo de la comanda (consumo sin propina), en pesos.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_FILTER_AMOUNT)
  minTotal?: number;

  @ApiPropertyOptional({
    example: 50000,
    description: 'Total maximo de la comanda (consumo sin propina), en pesos.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_FILTER_AMOUNT)
  maxTotal?: number;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Comandas que contienen este producto (id del item de carta).',
  })
  @IsOptional()
  @IsUUID()
  productId?: string;

  @ApiPropertyOptional({
    description:
      'Comandas que contienen un producto con este nombre (igualdad exacta sin distinguir mayusculas).',
  })
  @IsOptional()
  @IsString()
  @MaxLength(400)
  productName?: string;

  @ApiPropertyOptional({
    example: 'Cafe > Bebidas Calientes',
    description:
      'Comandas con productos bajo esta categoria (camino separado por ">", hasta 4 niveles).',
  })
  @IsOptional()
  @IsString()
  @MaxLength(900)
  categoryPath?: string;

  @ApiPropertyOptional({ enum: SALES_ORDER_BY, default: 'closedAt' })
  @IsOptional()
  @IsIn(SALES_ORDER_BY)
  orderBy?: (typeof SALES_ORDER_BY)[number];

  @ApiPropertyOptional({ enum: SORT_DIRECTIONS, default: 'desc' })
  @IsOptional()
  @IsIn(SORT_DIRECTIONS)
  direction?: (typeof SORT_DIRECTIONS)[number];
}

export class PaymentsReportQueryDto extends ReportRangeQueryDto {
  @ApiPropertyOptional({ enum: ['payment', 'attempt', 'all'], default: 'all' })
  @IsOptional()
  @IsIn(['payment', 'attempt', 'all'])
  kind?: 'payment' | 'attempt' | 'all';

  @ApiPropertyOptional({
    example: 'MANUAL',
    description: 'Proveedor del pago: MANUAL, MERCADO_PAGO o TRANSBANK.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  provider?: string;

  @ApiPropertyOptional({
    enum: REPORT_STATUSES,
    description:
      'Estado del pago (PAID, REFUNDED...) o del intento sin pago (PENDING, FAILED, CANCELLED).',
  })
  @IsOptional()
  @IsIn(REPORT_STATUSES)
  paymentStatus?: string;

  @ApiPropertyOptional({
    example: 1000,
    description: 'Monto minimo de la fila (consumo sin propina), en pesos.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_FILTER_AMOUNT)
  minAmount?: number;

  @ApiPropertyOptional({
    example: 50000,
    description: 'Monto maximo de la fila (consumo sin propina), en pesos.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_FILTER_AMOUNT)
  maxAmount?: number;

  @ApiPropertyOptional({ enum: PAYMENTS_ORDER_BY, default: 'eventAt' })
  @IsOptional()
  @IsIn(PAYMENTS_ORDER_BY)
  orderBy?: (typeof PAYMENTS_ORDER_BY)[number];

  @ApiPropertyOptional({ enum: SORT_DIRECTIONS, default: 'desc' })
  @IsOptional()
  @IsIn(SORT_DIRECTIONS)
  direction?: (typeof SORT_DIRECTIONS)[number];
}

export class SalesByHierarchyQueryDto extends ReportCommonFilterDto {
  @ApiPropertyOptional({
    description:
      'Id opaco de una categoria devuelto por una llamada anterior (nodes[].id o breadcrumb[].id). Ausente = categorias raiz. Solo aplica con groupBy=category.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  parentId?: string;

  @ApiPropertyOptional({ enum: HIERARCHY_GROUPS, default: 'category' })
  @IsOptional()
  @IsIn(HIERARCHY_GROUPS)
  groupBy?: HierarchyGroupBy;

  @ApiPropertyOptional({
    enum: ['true', 'false'],
    default: 'true',
    description:
      'true: el monto incluye los extras (modificadores). false: monto solo del precio base.',
  })
  @IsOptional()
  @IsIn(['true', 'false'])
  includeModifiers?: 'true' | 'false';

  @ApiPropertyOptional({ enum: ['json', 'csv'], default: 'json' })
  @IsOptional()
  @IsIn(['json', 'csv'])
  format?: 'json' | 'csv';
}

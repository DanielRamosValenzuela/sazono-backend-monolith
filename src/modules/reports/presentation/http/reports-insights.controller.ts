import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { buildVersionedControllerPath } from '../../../../common/http/api-version';
import { CurrentAuthUser } from '../../../auth/decorators/current-auth-user.decorator';
import { RequireProfileType } from '../../../auth/decorators/require-profile-type.decorator';
import { LoginProfileType } from '../../../auth/dto/login.dto';
import { JwtAuthGuard } from '../../../auth/guards/jwt-auth.guard';
import { ProfileTypeGuard } from '../../../auth/guards/profile-type.guard';
import type { JwtPayload } from '../../../auth/interfaces/jwt-payload.interface';
import {
  GetDailyZService,
  type DailyZResponse,
} from '../../application/get-daily-z.service';
import {
  GetOpenTabsService,
  type OpenTabsResponse,
} from '../../application/get-open-tabs.service';
import {
  GetSalesByMethodService,
  type SalesByMethodResponse,
} from '../../application/get-sales-by-method.service';
import type { CsvDownload } from '../../application/get-sales-by-order.service';
import {
  GetSalesByStaffService,
  type SalesByStaffResponse,
} from '../../application/get-sales-by-staff.service';
import {
  GetSalesByTimeService,
  type SalesByTimeResponse,
} from '../../application/get-sales-by-time.service';
import {
  GetSummaryKpisService,
  type SummaryKpisResponse,
} from '../../application/get-summary-kpis.service';
import {
  GetTipsReportService,
  type TipsResponse,
} from '../../application/get-tips-report.service';
import {
  DailyZQueryDto,
  InsightsQueryDto,
  OpenTabsQueryDto,
  SalesByStaffQueryDto,
  SalesByTimeQueryDto,
  SummaryKpisQueryDto,
} from './dto/reports-insights.dto';

function toCsvFile(download: CsvDownload): StreamableFile {
  return new StreamableFile(download.stream, {
    type: 'text/csv; charset=utf-8',
    disposition: `attachment; filename="${download.filename}"`,
  });
}

@ApiTags('reports')
@ApiBearerAuth()
@Controller(buildVersionedControllerPath('reports'))
export class ReportsInsightsController {
  constructor(
    private readonly getSalesByMethodService: GetSalesByMethodService,
    private readonly getSalesByStaffService: GetSalesByStaffService,
    private readonly getSalesByTimeService: GetSalesByTimeService,
    private readonly getTipsReportService: GetTipsReportService,
    private readonly getOpenTabsService: GetOpenTabsService,
    private readonly getSummaryKpisService: GetSummaryKpisService,
    private readonly getDailyZService: GetDailyZService,
  ) {}

  @Get('branches/:branchId/sales-by-method')
  @UseGuards(JwtAuthGuard, ProfileTypeGuard)
  @RequireProfileType(LoginProfileType.STAFF)
  @ApiOperation({
    summary:
      'Ventas por medio de pago: cantidad de pagos, monto (consumo sin propina), propina, reembolsado, neto y participacion. format=csv descarga el reporte. ADMIN y SUPERVISOR ven todo; CASHIER solo sus cobros de hoy.',
  })
  async getSalesByMethod(
    @CurrentAuthUser() authUser: JwtPayload,
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Query() query: InsightsQueryDto,
  ): Promise<SalesByMethodResponse | StreamableFile> {
    if (query.format === 'csv') {
      return toCsvFile(
        await this.getSalesByMethodService.executeCsv(
          authUser,
          branchId,
          query,
        ),
      );
    }

    return this.getSalesByMethodService.execute(authUser, branchId, query);
  }

  @Get('branches/:branchId/sales-by-staff')
  @UseGuards(JwtAuthGuard, ProfileTypeGuard)
  @RequireProfileType(LoginProfileType.STAFF)
  @ApiOperation({
    summary:
      'Ventas por mesero (role=waiter) o por cajero (role=cashier): cuentas, comensales, monto, ticket promedio, propina y propina por cuenta. CASHIER solo ve su propia fila de hoy en role=cashier y recibe 403 en role=waiter.',
  })
  async getSalesByStaff(
    @CurrentAuthUser() authUser: JwtPayload,
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Query() query: SalesByStaffQueryDto,
  ): Promise<SalesByStaffResponse | StreamableFile> {
    if (query.format === 'csv') {
      return toCsvFile(
        await this.getSalesByStaffService.executeCsv(authUser, branchId, query),
      );
    }

    return this.getSalesByStaffService.execute(authUser, branchId, query);
  }

  @Get('branches/:branchId/sales-by-time')
  @UseGuards(JwtAuthGuard, ProfileTypeGuard)
  @RequireProfileType(LoginProfileType.STAFF)
  @ApiOperation({
    summary:
      'Ventas por hora, dia de la semana (lunes primero), dia o mes en la zona horaria del restaurante. hour y weekday incluyen el mapa de calor 7x24.',
  })
  async getSalesByTime(
    @CurrentAuthUser() authUser: JwtPayload,
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Query() query: SalesByTimeQueryDto,
  ): Promise<SalesByTimeResponse | StreamableFile> {
    if (query.format === 'csv') {
      return toCsvFile(
        await this.getSalesByTimeService.executeCsv(authUser, branchId, query),
      );
    }

    return this.getSalesByTimeService.execute(authUser, branchId, query);
  }

  @Get('branches/:branchId/tips')
  @UseGuards(JwtAuthGuard, ProfileTypeGuard)
  @RequireProfileType(LoginProfileType.STAFF)
  @ApiOperation({
    summary:
      'Propinas: total, porcentaje sobre la venta, por mesero y por dia, devueltas y estado del plazo de pago de propinas con tarjeta (7 dias habiles).',
  })
  async getTips(
    @CurrentAuthUser() authUser: JwtPayload,
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Query() query: InsightsQueryDto,
  ): Promise<TipsResponse | StreamableFile> {
    if (query.format === 'csv') {
      return toCsvFile(
        await this.getTipsReportService.executeCsv(authUser, branchId, query),
      );
    }

    return this.getTipsReportService.execute(authUser, branchId, query);
  }

  @Get('branches/:branchId/open-tabs')
  @UseGuards(JwtAuthGuard, ProfileTypeGuard)
  @RequireProfileType(LoginProfileType.STAFF)
  @ApiOperation({
    summary:
      'Cuentas abiertas, abandonadas o con ordenes anuladas, con antiguedad en minutos, monto pendiente y alerta si una mesa lleva abierta mas de 180 minutos. Solo ADMIN y SUPERVISOR.',
  })
  async getOpenTabs(
    @CurrentAuthUser() authUser: JwtPayload,
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Query() query: OpenTabsQueryDto,
  ): Promise<OpenTabsResponse | StreamableFile> {
    if (query.format === 'csv') {
      return toCsvFile(
        await this.getOpenTabsService.executeCsv(authUser, branchId, query),
      );
    }

    return this.getOpenTabsService.execute(authUser, branchId, query);
  }

  @Get('branches/:branchId/summary-kpis')
  @UseGuards(JwtAuthGuard, ProfileTypeGuard)
  @RequireProfileType(LoginProfileType.STAFF)
  @ApiOperation({
    summary:
      'Indicadores del rango (venta neta, propinas, cuentas, ticket promedio, comensales, rotacion de mesas) y, con compare=previous, del rango anterior equivalente con variaciones.',
  })
  async getSummaryKpis(
    @CurrentAuthUser() authUser: JwtPayload,
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Query() query: SummaryKpisQueryDto,
  ): Promise<SummaryKpisResponse | StreamableFile> {
    if (query.format === 'csv') {
      return toCsvFile(
        await this.getSummaryKpisService.executeCsv(authUser, branchId, query),
      );
    }

    return this.getSummaryKpisService.execute(authUser, branchId, query);
  }

  @Get('branches/:branchId/daily-z')
  @UseGuards(JwtAuthGuard, ProfileTypeGuard)
  @RequireProfileType(LoginProfileType.STAFF)
  @ApiOperation({
    summary:
      'Z diario: rango de folios internos, neto, exento, IVA, propinas, reembolsos (base nota de credito), por medio de pago, por categoria y cierre de caja por cajero. CASHIER solo recibe su propio cierre de caja de hoy.',
  })
  getDailyZ(
    @CurrentAuthUser() authUser: JwtPayload,
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Query() query: DailyZQueryDto,
  ): Promise<DailyZResponse> {
    return this.getDailyZService.execute(authUser, branchId, query.date);
  }
}

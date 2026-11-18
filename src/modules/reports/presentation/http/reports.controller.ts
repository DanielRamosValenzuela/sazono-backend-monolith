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
  GetFilterOptionsService,
  type FilterOptionsResponse,
} from '../../application/get-filter-options.service';
import {
  GetOrderDetailService,
  type OrderDetailResponse,
} from '../../application/get-order-detail.service';
import {
  GetPaymentsReportService,
  type PaymentsReportResponse,
} from '../../application/get-payments-report.service';
import {
  GetRefundsReportService,
  type RefundsReportResponse,
} from '../../application/get-refunds-report.service';
import {
  GetSalesByHierarchyService,
  type SalesByHierarchyResponse,
} from '../../application/get-sales-by-hierarchy.service';
import {
  GetSalesByOrderService,
  type CsvDownload,
  type SalesByOrderResponse,
} from '../../application/get-sales-by-order.service';
import {
  PaymentsReportQueryDto,
  RefundsReportQueryDto,
  SalesByHierarchyQueryDto,
  SalesByOrderQueryDto,
} from './dto/reports.dto';

function toCsvFile(download: CsvDownload): StreamableFile {
  return new StreamableFile(download.stream, {
    type: 'text/csv; charset=utf-8',
    disposition: `attachment; filename="${download.filename}"`,
  });
}

@ApiTags('reports')
@ApiBearerAuth()
@Controller(buildVersionedControllerPath('reports'))
export class ReportsController {
  constructor(
    private readonly getSalesByOrderService: GetSalesByOrderService,
    private readonly getPaymentsReportService: GetPaymentsReportService,
    private readonly getSalesByHierarchyService: GetSalesByHierarchyService,
    private readonly getOrderDetailService: GetOrderDetailService,
    private readonly getFilterOptionsService: GetFilterOptionsService,
    private readonly getRefundsReportService: GetRefundsReportService,
  ) {}

  @Get('branches/:branchId/sales-by-order')
  @UseGuards(JwtAuthGuard, ProfileTypeGuard)
  @RequireProfileType(LoginProfileType.STAFF)
  @ApiOperation({
    summary:
      'Cierre por comanda: una fila por cuenta cerrada con una columna por medio de pago, totales sobre todo el filtro y paginacion por cursor. format=csv descarga el reporte completo (separador ";", BOM UTF-8). ADMIN y SUPERVISOR ven todo; CASHIER solo sus cobros de hoy.',
  })
  async getSalesByOrder(
    @CurrentAuthUser() authUser: JwtPayload,
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Query() query: SalesByOrderQueryDto,
  ): Promise<SalesByOrderResponse | StreamableFile> {
    if (query.format === 'csv') {
      return toCsvFile(
        await this.getSalesByOrderService.executeCsv(authUser, branchId, query),
      );
    }

    return this.getSalesByOrderService.execute(authUser, branchId, query);
  }

  @Get('branches/:branchId/sales-by-hierarchy')
  @UseGuards(JwtAuthGuard, ProfileTypeGuard)
  @RequireProfileType(LoginProfileType.STAFF)
  @ApiOperation({
    summary:
      'Jerarquia de ventas (categoria > subcategoria > producto) con drill-down por parentId, o lista plana por producto o estacion. Solo ADMIN y SUPERVISOR. format=csv descarga la vista actual (separador ";", BOM UTF-8).',
  })
  async getSalesByHierarchy(
    @CurrentAuthUser() authUser: JwtPayload,
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Query() query: SalesByHierarchyQueryDto,
  ): Promise<SalesByHierarchyResponse | StreamableFile> {
    if (query.format === 'csv') {
      return toCsvFile(
        await this.getSalesByHierarchyService.executeCsv(
          authUser,
          branchId,
          query,
        ),
      );
    }

    return this.getSalesByHierarchyService.execute(authUser, branchId, query);
  }

  @Get('branches/:branchId/payments')
  @UseGuards(JwtAuthGuard, ProfileTypeGuard)
  @RequireProfileType(LoginProfileType.STAFF)
  @ApiOperation({
    summary:
      'Detalle de pagos: pagos registrados mas intentos fallidos, pendientes o cancelados sin pago, con totales por estado y por medio. format=csv descarga el reporte completo. ADMIN y SUPERVISOR ven todo; CASHIER solo sus cobros de hoy.',
  })
  async getPayments(
    @CurrentAuthUser() authUser: JwtPayload,
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Query() query: PaymentsReportQueryDto,
  ): Promise<PaymentsReportResponse | StreamableFile> {
    if (query.format === 'csv') {
      return toCsvFile(
        await this.getPaymentsReportService.executeCsv(
          authUser,
          branchId,
          query,
        ),
      );
    }

    return this.getPaymentsReportService.execute(authUser, branchId, query);
  }

  @Get('branches/:branchId/refunds')
  @UseGuards(JwtAuthGuard, ProfileTypeGuard)
  @RequireProfileType(LoginProfileType.STAFF)
  @ApiOperation({
    summary:
      'Reembolsos registrados en el rango (por fecha del reembolso, hora del restaurante) con totales por medio, motivo y quien los registro. format=csv descarga el reporte completo. ADMIN y SUPERVISOR ven todo; CASHIER solo los que el registro hoy.',
  })
  async getRefunds(
    @CurrentAuthUser() authUser: JwtPayload,
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Query() query: RefundsReportQueryDto,
  ): Promise<RefundsReportResponse | StreamableFile> {
    if (query.format === 'csv') {
      return toCsvFile(
        await this.getRefundsReportService.executeCsv(
          authUser,
          branchId,
          query,
        ),
      );
    }

    return this.getRefundsReportService.execute(authUser, branchId, query);
  }

  @Get('branches/:branchId/orders/:billId/detail')
  @UseGuards(JwtAuthGuard, ProfileTypeGuard)
  @RequireProfileType(LoginProfileType.STAFF)
  @ApiOperation({
    summary:
      'Detalle completo de una comanda: cabecera, productos con modificadores y notas, pagos, propinas, conciliacion y banderas de auditoria. ADMIN y SUPERVISOR ven cualquier comanda de la sucursal; CASHIER solo si cobro un pago de esa comanda hoy.',
  })
  getOrderDetail(
    @CurrentAuthUser() authUser: JwtPayload,
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Param('billId', ParseUUIDPipe) billId: string,
  ): Promise<OrderDetailResponse> {
    return this.getOrderDetailService.execute(authUser, branchId, billId);
  }

  @Get('branches/:branchId/filter-options')
  @UseGuards(JwtAuthGuard, ProfileTypeGuard)
  @RequireProfileType(LoginProfileType.STAFF)
  @ApiOperation({
    summary:
      'Opciones para construir los filtros de los reportes en una sola llamada: personal, mesas, zonas, medios de pago en uso, categorias y productos vendidos en los ultimos 90 dias. CASHIER solo ve su propio usuario en el personal.',
  })
  getFilterOptions(
    @CurrentAuthUser() authUser: JwtPayload,
    @Param('branchId', ParseUUIDPipe) branchId: string,
  ): Promise<FilterOptionsResponse> {
    return this.getFilterOptionsService.execute(authUser, branchId);
  }
}

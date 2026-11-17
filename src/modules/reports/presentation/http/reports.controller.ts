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
  GetPaymentsReportService,
  type PaymentsReportResponse,
} from '../../application/get-payments-report.service';
import {
  GetSalesByOrderService,
  type CsvDownload,
  type SalesByOrderResponse,
} from '../../application/get-sales-by-order.service';
import { PaymentsReportQueryDto, ReportRangeQueryDto } from './dto/reports.dto';

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
    @Query() query: ReportRangeQueryDto,
  ): Promise<SalesByOrderResponse | StreamableFile> {
    if (query.format === 'csv') {
      return toCsvFile(
        await this.getSalesByOrderService.executeCsv(authUser, branchId, query),
      );
    }

    return this.getSalesByOrderService.execute(authUser, branchId, query);
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
}

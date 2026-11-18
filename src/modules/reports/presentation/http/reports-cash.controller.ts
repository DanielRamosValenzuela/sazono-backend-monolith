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
  GetCashSessionsReportService,
  type CashSessionsResponse,
} from '../../application/get-cash-sessions-report.service';
import { InsightsQueryDto } from './dto/reports-insights.dto';

@ApiTags('reports')
@ApiBearerAuth()
@Controller(buildVersionedControllerPath('reports'))
export class ReportsCashController {
  constructor(
    private readonly cashSessionsService: GetCashSessionsReportService,
  ) {}

  @Get('branches/:branchId/cash-sessions')
  @UseGuards(JwtAuthGuard, ProfileTypeGuard)
  @RequireProfileType(LoginProfileType.STAFF)
  @ApiOperation({
    summary:
      'Sesiones de caja del rango (por fecha de apertura) con apertura, esperado, contado y diferencia, y diferencia por cajero. format=csv descarga el reporte. CASHIER solo ve las propias de hoy. El detalle de una sesion esta en GET /branches/:branchId/cash-sessions/:id.',
  })
  async getCashSessions(
    @CurrentAuthUser() authUser: JwtPayload,
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Query() query: InsightsQueryDto,
  ): Promise<CashSessionsResponse | StreamableFile> {
    if (query.format === 'csv') {
      const download = await this.cashSessionsService.executeCsv(
        authUser,
        branchId,
        query,
      );

      return new StreamableFile(download.stream, {
        type: 'text/csv; charset=utf-8',
        disposition: `attachment; filename="${download.filename}"`,
      });
    }

    return this.cashSessionsService.execute(authUser, branchId, query);
  }
}

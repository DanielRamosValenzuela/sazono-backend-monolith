import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { buildVersionedControllerPath } from '../../../../common/http/api-version';
import { RequireProfileType } from '../../../auth/decorators/require-profile-type.decorator';
import { LoginProfileType } from '../../../auth/dto/login.dto';
import { JwtAuthGuard } from '../../../auth/guards/jwt-auth.guard';
import { ProfileTypeGuard } from '../../../auth/guards/profile-type.guard';
import {
  PlatformStatementsService,
  type FinalizeResponse,
  type StatementDetailResponse,
  type StatementRow,
  type StatementsListResponse,
} from '../../application/platform-statements.service';
import {
  StatementExportQueryDto,
  StatementPeriodQueryDto,
  UpdateStatementStatusDto,
} from './dto/platform-statements.dto';

@ApiTags('platform-billing')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, ProfileTypeGuard)
@RequireProfileType(LoginProfileType.PLATFORM_ADMIN)
@Controller(buildVersionedControllerPath('platform/statements'))
export class PlatformStatementsController {
  constructor(private readonly service: PlatformStatementsService) {}

  @Get()
  @ApiOperation({
    summary:
      'Estados de cuenta mensuales de la comision de plataforma: una fila por restaurante activo.',
  })
  list(
    @Query() query: StatementPeriodQueryDto,
  ): Promise<StatementsListResponse> {
    return this.service.list(query.period);
  }

  @Get('export')
  @ApiOperation({
    summary: 'Exporta los estados de cuenta del periodo (CSV ";" con BOM).',
  })
  async export(
    @Query() query: StatementExportQueryDto,
  ): Promise<StreamableFile> {
    const download = await this.service.exportCsv(query.period);

    return new StreamableFile(download.stream, {
      type: 'text/csv; charset=utf-8',
      disposition: `attachment; filename="${download.filename}"`,
    });
  }

  @Get(':restaurantId')
  @ApiOperation({
    summary:
      'Detalle de auditoria de un restaurante: por sucursal, por dia y por medio de pago.',
  })
  detail(
    @Param('restaurantId', ParseUUIDPipe) restaurantId: string,
    @Query() query: StatementPeriodQueryDto,
  ): Promise<StatementDetailResponse> {
    return this.service.detail(restaurantId, query.period);
  }

  @Post(':period/finalize')
  @ApiOperation({
    summary:
      'Congela el mes como ISSUED para todos los restaurantes activos. Idempotente.',
  })
  finalize(@Param('period') period: string): Promise<FinalizeResponse> {
    return this.service.finalize(period);
  }

  @Patch(':restaurantId/:period')
  @ApiOperation({
    summary: 'Marca un estado de cuenta emitido como PAID, WAIVED o VOID.',
  })
  updateStatus(
    @Param('restaurantId', ParseUUIDPipe) restaurantId: string,
    @Param('period') period: string,
    @Body() dto: UpdateStatementStatusDto,
  ): Promise<StatementRow> {
    return this.service.updateStatus(
      restaurantId,
      period,
      dto.status,
      dto.notes,
    );
  }
}

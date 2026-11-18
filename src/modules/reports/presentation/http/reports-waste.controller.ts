import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
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
  GetWasteReportService,
  type WasteReportResponse,
} from '../../application/get-waste-report.service';
import { ReportDateRangeDto } from './dto/reports.dto';

@ApiTags('reports')
@ApiBearerAuth()
@Controller(buildVersionedControllerPath('reports'))
export class ReportsWasteController {
  constructor(private readonly wasteReportService: GetWasteReportService) {}

  @Get('branches/:branchId/waste')
  @UseGuards(JwtAuthGuard, ProfileTypeGuard)
  @RequireProfileType(LoginProfileType.STAFF)
  @ApiOperation({
    summary:
      'Merma por producto y estacion: items reembolsados marcados como ya preparados. ADMIN y SUPERVISOR.',
  })
  getWaste(
    @CurrentAuthUser() authUser: JwtPayload,
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Query() query: ReportDateRangeDto,
  ): Promise<WasteReportResponse> {
    return this.wasteReportService.execute(authUser, branchId, query);
  }
}

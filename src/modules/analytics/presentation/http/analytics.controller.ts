import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { buildVersionedControllerPath } from '../../../../common/http/api-version';
import { CurrentAuthUser } from '../../../auth/decorators/current-auth-user.decorator';
import { RequireProfileType } from '../../../auth/decorators/require-profile-type.decorator';
import { LoginProfileType } from '../../../auth/dto/login.dto';
import { JwtAuthGuard } from '../../../auth/guards/jwt-auth.guard';
import { ProfileTypeGuard } from '../../../auth/guards/profile-type.guard';
import type { JwtPayload } from '../../../auth/interfaces/jwt-payload.interface';
import { GetBranchSummaryService } from '../../application/get-branch-summary.service';
import {
  BranchSummaryResponseDto,
  GetBranchSummaryQueryDto,
} from './dto/analytics.dto';

@ApiTags('analytics')
@ApiBearerAuth()
@Controller(buildVersionedControllerPath('analytics'))
export class AnalyticsController {
  constructor(
    private readonly getBranchSummaryService: GetBranchSummaryService,
  ) {}

  @Get('branches/:branchId/summary')
  @UseGuards(JwtAuthGuard, ProfileTypeGuard)
  @RequireProfileType(LoginProfileType.STAFF)
  @ApiOperation({
    summary:
      'Retorna el resumen operativo de una sucursal para el dashboard staff. Acepta from/to opcionales (YYYY-MM-DD) para acotar la serie diaria, pedidos por estado y top productos a un rango elegido; sin ellos usa las ventanas por defecto (7 y 30 dias).',
  })
  getBranchSummary(
    @CurrentAuthUser() authUser: JwtPayload,
    @Param('branchId') branchId: string,
    @Query() query: GetBranchSummaryQueryDto,
  ): Promise<BranchSummaryResponseDto> {
    return this.getBranchSummaryService.execute(authUser, branchId, query);
  }
}

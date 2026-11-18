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
  GetDiscountsReportService,
  type DiscountsReportResponse,
} from '../../application/get-discounts-report.service';
import { DiscountsReportQueryDto } from './dto/reports-discounts.dto';

@ApiTags('reports')
@ApiBearerAuth()
@Controller(buildVersionedControllerPath('reports'))
export class ReportsDiscountsController {
  constructor(
    private readonly discountsReportService: GetDiscountsReportService,
  ) {}

  @Get('branches/:branchId/discounts')
  @UseGuards(JwtAuthGuard, ProfileTypeGuard)
  @RequireProfileType(LoginProfileType.STAFF)
  @ApiOperation({
    summary:
      'Descuentos del rango (por fecha de aplicacion) con totales por motivo, cajero y aprobador. ADMIN y SUPERVISOR ven todo; CASHIER solo los suyos de hoy.',
  })
  getDiscounts(
    @CurrentAuthUser() authUser: JwtPayload,
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Query() query: DiscountsReportQueryDto,
  ): Promise<DiscountsReportResponse> {
    return this.discountsReportService.execute(authUser, branchId, query);
  }
}

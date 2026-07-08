import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { buildVersionedControllerPath } from '../../../../common/http/api-version';
import { CurrentAuthUser } from '../../../auth/decorators/current-auth-user.decorator';
import { RequireProfileType } from '../../../auth/decorators/require-profile-type.decorator';
import { LoginProfileType } from '../../../auth/dto/login.dto';
import { JwtAuthGuard } from '../../../auth/guards/jwt-auth.guard';
import { ProfileTypeGuard } from '../../../auth/guards/profile-type.guard';
import type { JwtPayload } from '../../../auth/interfaces/jwt-payload.interface';
import { GetCurrentBillService } from '../../application/get-current-bill.service';
import { ListBranchOpenBillsService } from '../../application/list-branch-open-bills.service';
import { BillResponseDto, BranchOpenBillResponseDto } from './dto/billing.dto';

@ApiTags('billing')
@ApiBearerAuth()
@Controller(buildVersionedControllerPath('billing'))
export class BillingController {
  constructor(
    private readonly getCurrentBillService: GetCurrentBillService,
    private readonly listBranchOpenBillsService: ListBranchOpenBillsService,
  ) {}

  @Get('table-sessions/:tableSessionId/current-bill')
  @UseGuards(JwtAuthGuard, ProfileTypeGuard)
  @RequireProfileType(LoginProfileType.STAFF)
  @ApiOperation({
    summary: 'Retorna la cuenta operativa actual asociada a una TableSession.',
  })
  getCurrentBill(
    @CurrentAuthUser() authUser: JwtPayload,
    @Param('tableSessionId') tableSessionId: string,
  ): Promise<BillResponseDto> {
    return this.getCurrentBillService.execute(authUser, tableSessionId);
  }

  @Get('branches/:branchId/open-bills')
  @UseGuards(JwtAuthGuard, ProfileTypeGuard)
  @RequireProfileType(LoginProfileType.STAFF)
  @ApiOperation({
    summary:
      'Lista las cuentas de todas las sesiones activas de la sucursal, para una vista consolidada de caja/supervisor.',
  })
  listBranchOpenBills(
    @CurrentAuthUser() authUser: JwtPayload,
    @Param('branchId') branchId: string,
  ): Promise<BranchOpenBillResponseDto[]> {
    return this.listBranchOpenBillsService.execute(authUser, branchId);
  }
}

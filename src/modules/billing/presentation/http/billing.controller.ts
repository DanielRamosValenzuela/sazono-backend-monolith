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
import { BillResponseDto } from './dto/billing.dto';

@ApiTags('billing')
@ApiBearerAuth()
@Controller(buildVersionedControllerPath('billing'))
export class BillingController {
  constructor(private readonly getCurrentBillService: GetCurrentBillService) {}

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
}

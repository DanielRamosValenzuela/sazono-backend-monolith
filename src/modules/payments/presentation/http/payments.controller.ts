import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { buildVersionedControllerPath } from '../../../../common/http/api-version';
import { CurrentAuthUser } from '../../../auth/decorators/current-auth-user.decorator';
import { RequireProfileType } from '../../../auth/decorators/require-profile-type.decorator';
import { LoginProfileType } from '../../../auth/dto/login.dto';
import { JwtAuthGuard } from '../../../auth/guards/jwt-auth.guard';
import { ProfileTypeGuard } from '../../../auth/guards/profile-type.guard';
import type { JwtPayload } from '../../../auth/interfaces/jwt-payload.interface';
import { CreateBillSplitService } from '../../application/create-bill-split.service';
import { GetCurrentBillSplitService } from '../../application/get-current-bill-split.service';
import { ListBillPaymentsService } from '../../application/list-bill-payments.service';
import { PayBillService } from '../../application/pay-bill.service';
import {
  BillSplitResponseDto,
  CreateBillSplitDto,
  PayBillDto,
  PaymentResultResponseDto,
  PaymentSummaryResponseDto,
} from './dto/payments.dto';

@ApiTags('payments')
@ApiBearerAuth()
@Controller(buildVersionedControllerPath('payments'))
export class PaymentsController {
  constructor(
    private readonly payBillService: PayBillService,
    private readonly listBillPaymentsService: ListBillPaymentsService,
    private readonly createBillSplitService: CreateBillSplitService,
    private readonly getCurrentBillSplitService: GetCurrentBillSplitService,
  ) {}

  @Post('bills/:billId')
  @UseGuards(JwtAuthGuard, ProfileTypeGuard)
  @RequireProfileType(LoginProfileType.STAFF)
  @ApiOperation({
    summary:
      'Registra un pago total o parcial de una cuenta desde caja, supervisor o admin.',
  })
  payBill(
    @CurrentAuthUser() authUser: JwtPayload,
    @Param('billId') billId: string,
    @Body() dto: PayBillDto,
  ): Promise<PaymentResultResponseDto> {
    return this.payBillService.execute(authUser, billId, dto);
  }

  @Get('bills/:billId')
  @UseGuards(JwtAuthGuard, ProfileTypeGuard)
  @RequireProfileType(LoginProfileType.STAFF)
  @ApiOperation({
    summary: 'Lista los pagos registrados sobre una cuenta.',
  })
  listBillPayments(
    @CurrentAuthUser() authUser: JwtPayload,
    @Param('billId') billId: string,
  ): Promise<PaymentSummaryResponseDto[]> {
    return this.listBillPaymentsService.execute(authUser, billId);
  }

  @Post('bills/:billId/splits')
  @UseGuards(JwtAuthGuard, ProfileTypeGuard)
  @RequireProfileType(LoginProfileType.STAFF)
  @ApiOperation({
    summary:
      'Divide el saldo pendiente de la cuenta entre participantes con split BY_AMOUNT.',
  })
  createBillSplit(
    @CurrentAuthUser() authUser: JwtPayload,
    @Param('billId') billId: string,
    @Body() dto: CreateBillSplitDto,
  ): Promise<BillSplitResponseDto> {
    return this.createBillSplitService.executeForStaff(authUser, billId, dto);
  }

  @Get('bills/:billId/splits/current')
  @UseGuards(JwtAuthGuard, ProfileTypeGuard)
  @RequireProfileType(LoginProfileType.STAFF)
  @ApiOperation({
    summary: 'Retorna el split activo de la cuenta, si existe.',
  })
  getCurrentBillSplit(
    @CurrentAuthUser() authUser: JwtPayload,
    @Param('billId') billId: string,
  ): Promise<BillSplitResponseDto | null> {
    return this.getCurrentBillSplitService.executeForStaff(authUser, billId);
  }
}

import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { buildVersionedControllerPath } from '../../../../common/http/api-version';
import { CreateBillSplitService } from '../../application/create-bill-split.service';
import { GetCurrentBillSplitService } from '../../application/get-current-bill-split.service';
import { PayBillSplitParticipantService } from '../../application/pay-bill-split-participant.service';
import { PayQrBillService } from '../../application/pay-qr-bill.service';
import { PayQrOrderService } from '../../application/pay-qr-order.service';
import {
  BillSplitResponseDto,
  CreateBillSplitDto,
  PayBillDto,
  PayBillSplitParticipantDto,
  PayQrOrderDto,
  PaymentResultResponseDto,
} from './dto/payments.dto';

@ApiTags('qr')
@Controller(buildVersionedControllerPath('qr'))
export class QrPaymentsController {
  constructor(
    private readonly payQrOrderService: PayQrOrderService,
    private readonly payQrBillService: PayQrBillService,
    private readonly createBillSplitService: CreateBillSplitService,
    private readonly getCurrentBillSplitService: GetCurrentBillSplitService,
    private readonly payBillSplitParticipantService: PayBillSplitParticipantService,
  ) {}

  @Post('tables/:qrToken/orders/:orderId/pay')
  @ApiOperation({
    summary:
      'Aprueba el prepago de una orden QR: carga la cuenta y enruta a estaciones. Endpoint publico.',
  })
  payQrOrder(
    @Param('qrToken') qrToken: string,
    @Param('orderId') orderId: string,
    @Body() dto: PayQrOrderDto,
  ): Promise<PaymentResultResponseDto> {
    return this.payQrOrderService.execute(qrToken, orderId, dto);
  }

  @Post('tables/:qrToken/bill/payments')
  @ApiOperation({
    summary:
      'Paga total o parcialmente la cuenta abierta de la mesa desde el QR. Endpoint publico.',
  })
  payQrBill(
    @Param('qrToken') qrToken: string,
    @Body() dto: PayBillDto,
  ): Promise<PaymentResultResponseDto> {
    return this.payQrBillService.execute(qrToken, dto);
  }

  @Post('tables/:qrToken/bill/splits')
  @ApiOperation({
    summary:
      'Divide el saldo pendiente de la cuenta de la mesa entre participantes. Endpoint publico.',
  })
  createQrBillSplit(
    @Param('qrToken') qrToken: string,
    @Body() dto: CreateBillSplitDto,
  ): Promise<BillSplitResponseDto> {
    return this.createBillSplitService.executeForQrToken(qrToken, dto);
  }

  @Get('tables/:qrToken/bill/splits/current')
  @ApiOperation({
    summary: 'Retorna el split activo de la mesa, si existe. Endpoint publico.',
  })
  getCurrentQrBillSplit(
    @Param('qrToken') qrToken: string,
  ): Promise<BillSplitResponseDto | null> {
    return this.getCurrentBillSplitService.executeForQrToken(qrToken);
  }

  @Post('split-participants/:participantToken/pay')
  @ApiOperation({
    summary:
      'Paga la parte pendiente de un participante del split usando su token. Endpoint publico.',
  })
  payBillSplitParticipant(
    @Param('participantToken') participantToken: string,
    @Body() dto: PayBillSplitParticipantDto,
  ): Promise<PaymentResultResponseDto> {
    return this.payBillSplitParticipantService.execute(participantToken, dto);
  }
}

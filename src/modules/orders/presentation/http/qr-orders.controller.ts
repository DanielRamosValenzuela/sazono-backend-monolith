import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { buildVersionedControllerPath } from '../../../../common/http/api-version';
import { CreateQrOrderService } from '../../application/create-qr-order.service';
import { ListQrSessionOrdersService } from '../../application/list-qr-session-orders.service';
import { CreateQrOrderDto, OrderResponseDto } from './dto/orders.dto';

@ApiTags('qr')
@Controller(buildVersionedControllerPath('qr'))
export class QrOrdersController {
  constructor(
    private readonly createQrOrderService: CreateQrOrderService,
    private readonly listQrSessionOrdersService: ListQrSessionOrdersService,
  ) {}

  @Post('tables/:qrToken/orders')
  @ApiOperation({
    summary:
      'Crea una orden prepago desde el QR de la mesa. Queda en AWAITING_PAYMENT hasta aprobar el pago. Endpoint publico.',
  })
  createQrOrder(
    @Param('qrToken') qrToken: string,
    @Body() dto: CreateQrOrderDto,
  ): Promise<OrderResponseDto> {
    return this.createQrOrderService.execute(qrToken, dto);
  }

  @Get('tables/:qrToken/orders')
  @ApiOperation({
    summary:
      'Lista las ordenes de la sesion activa de la mesa del QR. Endpoint publico.',
  })
  listQrSessionOrders(
    @Param('qrToken') qrToken: string,
  ): Promise<OrderResponseDto[]> {
    return this.listQrSessionOrdersService.execute(qrToken);
  }
}

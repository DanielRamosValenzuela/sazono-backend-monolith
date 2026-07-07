import {
  Body,
  Controller,
  Get,
  Param,
  Post,
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
import { CancelOrderService } from '../../application/cancel-order.service';
import { CreateWaiterOrderService } from '../../application/create-waiter-order.service';
import { DeliverOrderService } from '../../application/deliver-order.service';
import { GetOrderDetailService } from '../../application/get-order-detail.service';
import { ListSessionOrdersService } from '../../application/list-session-orders.service';
import {
  CancelOrderDto,
  CreateWaiterOrderDto,
  ListOrdersQueryDto,
  OrderResponseDto,
} from './dto/orders.dto';

@ApiTags('orders')
@ApiBearerAuth()
@Controller(buildVersionedControllerPath('orders'))
export class OrdersController {
  constructor(
    private readonly createWaiterOrderService: CreateWaiterOrderService,
    private readonly listSessionOrdersService: ListSessionOrdersService,
    private readonly getOrderDetailService: GetOrderDetailService,
    private readonly deliverOrderService: DeliverOrderService,
    private readonly cancelOrderService: CancelOrderService,
  ) {}

  @Post()
  @UseGuards(JwtAuthGuard, ProfileTypeGuard)
  @RequireProfileType(LoginProfileType.STAFF)
  @ApiOperation({
    summary:
      'Crea una orden pospago de mesero, la carga a la cuenta y la enruta a las estaciones.',
  })
  createWaiterOrder(
    @CurrentAuthUser() authUser: JwtPayload,
    @Body() dto: CreateWaiterOrderDto,
  ): Promise<OrderResponseDto> {
    return this.createWaiterOrderService.execute(authUser, dto);
  }

  @Get()
  @UseGuards(JwtAuthGuard, ProfileTypeGuard)
  @RequireProfileType(LoginProfileType.STAFF)
  @ApiOperation({
    summary: 'Lista las ordenes de una sesion de mesa.',
  })
  listSessionOrders(
    @CurrentAuthUser() authUser: JwtPayload,
    @Query() query: ListOrdersQueryDto,
  ): Promise<OrderResponseDto[]> {
    return this.listSessionOrdersService.execute(authUser, query);
  }

  @Get(':orderId')
  @UseGuards(JwtAuthGuard, ProfileTypeGuard)
  @RequireProfileType(LoginProfileType.STAFF)
  @ApiOperation({
    summary: 'Retorna el detalle de una orden con items y tickets.',
  })
  getOrderDetail(
    @CurrentAuthUser() authUser: JwtPayload,
    @Param('orderId') orderId: string,
  ): Promise<OrderResponseDto> {
    return this.getOrderDetailService.execute(authUser, orderId);
  }

  @Post(':orderId/deliver')
  @UseGuards(JwtAuthGuard, ProfileTypeGuard)
  @RequireProfileType(LoginProfileType.STAFF)
  @ApiOperation({
    summary: 'Marca como entregada una orden lista en todas sus estaciones.',
  })
  deliverOrder(
    @CurrentAuthUser() authUser: JwtPayload,
    @Param('orderId') orderId: string,
  ): Promise<OrderResponseDto> {
    return this.deliverOrderService.execute(authUser, orderId);
  }

  @Post(':orderId/cancel')
  @UseGuards(JwtAuthGuard, ProfileTypeGuard)
  @RequireProfileType(LoginProfileType.STAFF)
  @ApiOperation({
    summary:
      'Cancela una orden: antes de produccion cualquier staff operativo; en produccion solo supervisor o admin con reverso de cargos.',
  })
  cancelOrder(
    @CurrentAuthUser() authUser: JwtPayload,
    @Param('orderId') orderId: string,
    @Body() dto: CancelOrderDto,
  ): Promise<OrderResponseDto> {
    return this.cancelOrderService.execute(authUser, orderId, dto);
  }
}

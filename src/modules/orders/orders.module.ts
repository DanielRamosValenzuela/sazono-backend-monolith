import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ProfileTypeGuard } from '../auth/guards/profile-type.guard';
import { CancelOrderService } from './application/cancel-order.service';
import { CreateQrOrderService } from './application/create-qr-order.service';
import { CreateWaiterOrderService } from './application/create-waiter-order.service';
import { DeliverOrderService } from './application/deliver-order.service';
import { GetOrderDetailService } from './application/get-order-detail.service';
import { ListBranchReadySummaryService } from './application/list-branch-ready-summary.service';
import { ListQrSessionOrdersService } from './application/list-qr-session-orders.service';
import { ListSessionOrdersService } from './application/list-session-orders.service';
import { OrderableMenuItemResolverService } from './application/orderable-menu-item-resolver.service';
import { OrdersController } from './presentation/http/orders.controller';
import { QrOrdersController } from './presentation/http/qr-orders.controller';

@Module({
  imports: [AuthModule],
  controllers: [OrdersController, QrOrdersController],
  providers: [
    OrderableMenuItemResolverService,
    CreateWaiterOrderService,
    CreateQrOrderService,
    ListSessionOrdersService,
    ListBranchReadySummaryService,
    ListQrSessionOrdersService,
    GetOrderDetailService,
    DeliverOrderService,
    CancelOrderService,
    JwtAuthGuard,
    ProfileTypeGuard,
  ],
})
export class OrdersModule {}

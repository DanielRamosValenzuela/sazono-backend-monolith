import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ProfileTypeGuard } from '../auth/guards/profile-type.guard';
import { OrderCreatedListener } from './application/order-created.listener';
import { PushNotificationService } from './application/push-notification.service';
import { RegisterDeviceTokenService } from './application/register-device-token.service';
import { StationTicketReadyListener } from './application/station-ticket-ready.listener';
import { UnregisterDeviceTokenService } from './application/unregister-device-token.service';
import { DeviceTokensController } from './presentation/http/device-tokens.controller';

@Module({
  imports: [AuthModule],
  controllers: [DeviceTokensController],
  providers: [
    PushNotificationService,
    RegisterDeviceTokenService,
    UnregisterDeviceTokenService,
    OrderCreatedListener,
    StationTicketReadyListener,
    JwtAuthGuard,
    ProfileTypeGuard,
  ],
  exports: [PushNotificationService],
})
export class NotificationsModule {}

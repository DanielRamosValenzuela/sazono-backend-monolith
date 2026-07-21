import { randomUUID } from 'node:crypto';

import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { validateEnvironment } from './common/config/validate-environment';
import { BranchAccessModule } from './common/branch-access/branch-access.module';
import { FirebaseModule } from './common/firebase/firebase.module';
import { PrismaModule } from './common/prisma/prisma.module';
import { SupabaseModule } from './common/supabase/supabase.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { AuthModule } from './modules/auth/auth.module';
import { BillingModule } from './modules/billing/billing.module';
import { BranchesModule } from './modules/branches/branches.module';
import { FloorModule } from './modules/floor/floor.module';
import { KitchenModule } from './modules/kitchen/kitchen.module';
import { LeadsModule } from './modules/leads/leads.module';
import { MenusModule } from './modules/menus/menus.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { OrdersModule } from './modules/orders/orders.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { RestaurantsModule } from './modules/restaurants/restaurants.module';
import { StaffModule } from './modules/staff/staff.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      envFilePath: ['.env.local', '.env'],
      validate: validateEnvironment,
    }),
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        pinoHttp: {
          level: configService.get<string>('LOG_LEVEL') ?? 'info',
          genReqId: (req) => {
            const requestId = req.headers['x-request-id'];

            if (typeof requestId === 'string' && requestId.length > 0) {
              return requestId;
            }

            return randomUUID();
          },
          redact: {
            paths: ['req.headers.authorization', 'req.headers.cookie'],
            remove: true,
          },
        },
      }),
    }),
    EventEmitterModule.forRoot(),
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => [
        {
          name: 'default',
          ttl: (configService.get<number>('THROTTLE_TTL_SECONDS') ?? 60) * 1000,
          limit: configService.get<number>('THROTTLE_LIMIT') ?? 100,
        },
      ],
    }),
    PrismaModule,
    BranchAccessModule,
    SupabaseModule,
    FirebaseModule,
    AuthModule,
    RestaurantsModule,
    BranchesModule,
    StaffModule,
    MenusModule,
    FloorModule,
    OrdersModule,
    KitchenModule,
    BillingModule,
    PaymentsModule,
    AnalyticsModule,
    LeadsModule,
    NotificationsModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}

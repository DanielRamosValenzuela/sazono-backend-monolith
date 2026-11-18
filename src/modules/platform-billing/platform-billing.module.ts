import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ProfileTypeGuard } from '../auth/guards/profile-type.guard';
import { PlatformStatementsService } from './application/platform-statements.service';
import { PlatformStatementsScheduler } from './infrastructure/platform-statements.scheduler';
import { PlatformStatementsController } from './presentation/http/platform-statements.controller';

@Module({
  imports: [AuthModule],
  controllers: [PlatformStatementsController],
  providers: [
    PlatformStatementsService,
    PlatformStatementsScheduler,
    JwtAuthGuard,
    ProfileTypeGuard,
  ],
})
export class PlatformBillingModule {}

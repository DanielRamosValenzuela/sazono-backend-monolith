import { Module } from '@nestjs/common';
import { AuditModule } from '../../common/audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ProfileTypeGuard } from '../auth/guards/profile-type.guard';
import { CashMovementsService } from './application/cash-movements.service';
import { CashSessionsService } from './application/cash-sessions.service';
import { CashController } from './presentation/http/cash.controller';

@Module({
  imports: [AuthModule, AuditModule],
  controllers: [CashController],
  providers: [
    CashSessionsService,
    CashMovementsService,
    JwtAuthGuard,
    ProfileTypeGuard,
  ],
})
export class CashModule {}

import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ProfileTypeGuard } from '../auth/guards/profile-type.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { BillingBranchAccessService } from './application/billing-branch-access.service';
import { GetCurrentBillService } from './application/get-current-bill.service';
import { BillingController } from './presentation/http/billing.controller';

@Module({
  imports: [AuthModule],
  controllers: [BillingController],
  providers: [
    BillingBranchAccessService,
    GetCurrentBillService,
    JwtAuthGuard,
    ProfileTypeGuard,
  ],
})
export class BillingModule {}

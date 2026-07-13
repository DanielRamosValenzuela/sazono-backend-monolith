import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ProfileTypeGuard } from '../auth/guards/profile-type.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { GetCurrentBillService } from './application/get-current-bill.service';
import { ListBranchOpenBillsService } from './application/list-branch-open-bills.service';
import { BillingController } from './presentation/http/billing.controller';

@Module({
  imports: [AuthModule],
  controllers: [BillingController],
  providers: [
    GetCurrentBillService,
    ListBranchOpenBillsService,
    JwtAuthGuard,
    ProfileTypeGuard,
  ],
})
export class BillingModule {}

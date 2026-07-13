import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ProfileTypeGuard } from '../auth/guards/profile-type.guard';
import { GetBranchSummaryService } from './application/get-branch-summary.service';
import { BranchAnalyticsPrismaRepository } from './infrastructure/prisma/branch-analytics.prisma.repository';
import { AnalyticsController } from './presentation/http/analytics.controller';

@Module({
  imports: [AuthModule],
  controllers: [AnalyticsController],
  providers: [
    GetBranchSummaryService,
    BranchAnalyticsPrismaRepository,
    JwtAuthGuard,
    ProfileTypeGuard,
  ],
})
export class AnalyticsModule {}

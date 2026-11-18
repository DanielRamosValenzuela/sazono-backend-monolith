import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ProfileTypeGuard } from '../auth/guards/profile-type.guard';
import { GetDailyZService } from './application/get-daily-z.service';
import { GetFilterOptionsService } from './application/get-filter-options.service';
import { GetOrderDetailService } from './application/get-order-detail.service';
import { GetRefundsReportService } from './application/get-refunds-report.service';
import { GetSalesByHierarchyService } from './application/get-sales-by-hierarchy.service';
import { GetPaymentsReportService } from './application/get-payments-report.service';
import { GetOpenTabsService } from './application/get-open-tabs.service';
import { GetSalesByMethodService } from './application/get-sales-by-method.service';
import { GetSalesByOrderService } from './application/get-sales-by-order.service';
import { GetSalesByStaffService } from './application/get-sales-by-staff.service';
import { GetSalesByTimeService } from './application/get-sales-by-time.service';
import { GetSummaryKpisService } from './application/get-summary-kpis.service';
import { GetTipsReportService } from './application/get-tips-report.service';
import { ReportScopeService } from './application/report-scope.service';
import { DailyZPrismaRepository } from './infrastructure/daily-z.prisma.repository';
import { ReportsInsightsPrismaRepository } from './infrastructure/reports-insights.prisma.repository';
import { ReportsPrismaRepository } from './infrastructure/reports.prisma.repository';
import { ReportsInsightsController } from './presentation/http/reports-insights.controller';
import { ReportsController } from './presentation/http/reports.controller';

@Module({
  imports: [AuthModule],
  controllers: [ReportsController, ReportsInsightsController],
  providers: [
    GetSalesByOrderService,
    GetPaymentsReportService,
    GetSalesByHierarchyService,
    GetOrderDetailService,
    GetFilterOptionsService,
    GetRefundsReportService,
    GetSalesByMethodService,
    GetSalesByStaffService,
    GetSalesByTimeService,
    GetTipsReportService,
    GetOpenTabsService,
    GetSummaryKpisService,
    GetDailyZService,
    DailyZPrismaRepository,
    ReportsInsightsPrismaRepository,
    ReportScopeService,
    ReportsPrismaRepository,
    JwtAuthGuard,
    ProfileTypeGuard,
  ],
})
export class ReportsModule {}

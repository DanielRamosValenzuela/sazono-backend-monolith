import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ProfileTypeGuard } from '../auth/guards/profile-type.guard';
import { GetFilterOptionsService } from './application/get-filter-options.service';
import { GetOrderDetailService } from './application/get-order-detail.service';
import { GetSalesByHierarchyService } from './application/get-sales-by-hierarchy.service';
import { GetPaymentsReportService } from './application/get-payments-report.service';
import { GetSalesByOrderService } from './application/get-sales-by-order.service';
import { ReportScopeService } from './application/report-scope.service';
import { ReportsPrismaRepository } from './infrastructure/reports.prisma.repository';
import { ReportsController } from './presentation/http/reports.controller';

@Module({
  imports: [AuthModule],
  controllers: [ReportsController],
  providers: [
    GetSalesByOrderService,
    GetPaymentsReportService,
    GetSalesByHierarchyService,
    GetOrderDetailService,
    GetFilterOptionsService,
    ReportScopeService,
    ReportsPrismaRepository,
    JwtAuthGuard,
    ProfileTypeGuard,
  ],
})
export class ReportsModule {}

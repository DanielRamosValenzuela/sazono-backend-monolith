import { Injectable } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import type { JwtPayload } from '../../auth/interfaces/jwt-payload.interface';
import { BranchAnalyticsPrismaRepository } from '../infrastructure/prisma/branch-analytics.prisma.repository';
import type { PaidPaymentRecord } from '../infrastructure/prisma/branch-analytics.prisma.repository';
import type {
  BranchSummaryResponseDto,
  DailyPaymentsMetricDto,
} from '../presentation/http/dto/analytics.dto';
import { AnalyticsBranchAccessService } from './analytics-branch-access.service';

const LAST_DAYS_WINDOW = 7;
const TOP_ITEMS_WINDOW_DAYS = 30;

@Injectable()
export class GetBranchSummaryService {
  constructor(
    private readonly analyticsBranchAccessService: AnalyticsBranchAccessService,
    private readonly branchAnalyticsRepository: BranchAnalyticsPrismaRepository,
  ) {}

  async execute(
    authUser: JwtPayload,
    branchId: string,
  ): Promise<BranchSummaryResponseDto> {
    await this.analyticsBranchAccessService.ensureAccess(authUser, branchId, [
      Role.ADMIN,
      Role.SUPERVISOR,
    ]);

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const paymentsRangeStart = new Date(startOfToday);
    paymentsRangeStart.setDate(
      paymentsRangeStart.getDate() - (LAST_DAYS_WINDOW - 1),
    );

    const topItemsRangeStart = new Date(
      Date.now() - TOP_ITEMS_WINDOW_DAYS * 24 * 60 * 60 * 1000,
    );

    const [
      totalTables,
      occupiedTables,
      openSessions,
      payments,
      orderGroups,
      topItems,
    ] = await Promise.all([
      this.branchAnalyticsRepository.countTables(branchId),
      this.branchAnalyticsRepository.countOccupiedTables(branchId),
      this.branchAnalyticsRepository.countOpenSessions(branchId),
      this.branchAnalyticsRepository.findPaidPaymentsSince(
        branchId,
        paymentsRangeStart,
      ),
      this.branchAnalyticsRepository.groupOrdersByStatusSince(
        branchId,
        startOfToday,
      ),
      this.branchAnalyticsRepository.findTopItemsSince(
        branchId,
        topItemsRangeStart,
      ),
    ]);

    const last7Days = this.buildLast7Days(startOfToday, payments);
    const today = last7Days[last7Days.length - 1];
    const todayAmount = new Prisma.Decimal(today.amount);
    const averageTicket =
      today.count > 0
        ? todayAmount.dividedBy(today.count).toFixed(2)
        : new Prisma.Decimal(0).toFixed(2);

    return {
      branchId,
      totalTables,
      occupiedTables,
      openSessions,
      todayRevenue: today.amount,
      todayPaymentsCount: today.count,
      averageTicket,
      last7Days,
      ordersByStatus: orderGroups.sort((a, b) => b.count - a.count),
      topItems: topItems.map((item) => ({
        name: item.name,
        quantity: item.quantity,
        amount: (item.amount ?? new Prisma.Decimal(0)).toFixed(2),
      })),
    };
  }

  private buildLast7Days(
    startOfToday: Date,
    payments: PaidPaymentRecord[],
  ): DailyPaymentsMetricDto[] {
    const totalsByDate = new Map<
      string,
      { amount: Prisma.Decimal; count: number }
    >();

    for (const payment of payments) {
      const dateKey = this.toDateKey(payment.paidAt ?? payment.createdAt);
      const current = totalsByDate.get(dateKey) ?? {
        amount: new Prisma.Decimal(0),
        count: 0,
      };

      totalsByDate.set(dateKey, {
        amount: current.amount.plus(payment.amount),
        count: current.count + 1,
      });
    }

    const last7Days: DailyPaymentsMetricDto[] = [];

    for (let daysAgo = LAST_DAYS_WINDOW - 1; daysAgo >= 0; daysAgo -= 1) {
      const day = new Date(startOfToday);
      day.setDate(day.getDate() - daysAgo);
      const dateKey = this.toDateKey(day);
      const totals = totalsByDate.get(dateKey);

      last7Days.push({
        date: dateKey,
        amount: (totals?.amount ?? new Prisma.Decimal(0)).toFixed(2),
        count: totals?.count ?? 0,
      });
    }

    return last7Days;
  }

  private toDateKey(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');

    return `${year}-${month}-${day}`;
  }
}

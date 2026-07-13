import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import type { JwtPayload } from '../../auth/interfaces/jwt-payload.interface';
import { BranchAnalyticsPrismaRepository } from '../infrastructure/prisma/branch-analytics.prisma.repository';
import type { PaidPaymentRecord } from '../infrastructure/prisma/branch-analytics.prisma.repository';
import type {
  BranchSummaryResponseDto,
  DailyPaymentsMetricDto,
  GetBranchSummaryQueryDto,
} from '../presentation/http/dto/analytics.dto';
import { BranchAccessService } from '../../../common/branch-access/branch-access.service';

const DEFAULT_SERIES_DAYS = 7;
const DEFAULT_TOP_ITEMS_WINDOW_DAYS = 30;
const MAX_RANGE_DAYS = 92;

type ResolvedRange = { start: Date; end: Date };

@Injectable()
export class GetBranchSummaryService {
  constructor(
    private readonly branchAccessService: BranchAccessService,
    private readonly branchAnalyticsRepository: BranchAnalyticsPrismaRepository,
  ) {}

  async execute(
    authUser: JwtPayload,
    branchId: string,
    query: GetBranchSummaryQueryDto,
  ): Promise<BranchSummaryResponseDto> {
    await this.branchAccessService.ensureAccess(authUser, branchId, [
      Role.ADMIN,
      Role.SUPERVISOR,
    ]);

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const endOfToday = this.endOfDay(startOfToday);

    const customRange = this.resolveCustomRange(query);

    const seriesRange: ResolvedRange = customRange ?? {
      start: this.daysBefore(startOfToday, DEFAULT_SERIES_DAYS - 1),
      end: endOfToday,
    };
    const ordersByStatusRange: ResolvedRange = customRange ?? {
      start: startOfToday,
      end: endOfToday,
    };
    const topItemsRange: ResolvedRange = customRange ?? {
      start: this.daysBefore(startOfToday, DEFAULT_TOP_ITEMS_WINDOW_DAYS - 1),
      end: endOfToday,
    };

    const [
      totalTables,
      occupiedTables,
      openSessions,
      todayPayments,
      seriesPayments,
      orderGroups,
      topItems,
    ] = await Promise.all([
      this.branchAnalyticsRepository.countTables(branchId),
      this.branchAnalyticsRepository.countOccupiedTables(branchId),
      this.branchAnalyticsRepository.countOpenSessions(branchId),
      this.branchAnalyticsRepository.findPaidPaymentsInRange(
        branchId,
        startOfToday,
        endOfToday,
      ),
      this.branchAnalyticsRepository.findPaidPaymentsInRange(
        branchId,
        seriesRange.start,
        seriesRange.end,
      ),
      this.branchAnalyticsRepository.groupOrdersByStatusInRange(
        branchId,
        ordersByStatusRange.start,
        ordersByStatusRange.end,
      ),
      this.branchAnalyticsRepository.findTopItemsInRange(
        branchId,
        topItemsRange.start,
        topItemsRange.end,
      ),
    ]);

    const todayAmount = todayPayments.reduce(
      (total, payment) => total.add(payment.amount),
      new Prisma.Decimal(0),
    );
    const averageTicket =
      todayPayments.length > 0
        ? todayAmount.dividedBy(todayPayments.length).toFixed(2)
        : new Prisma.Decimal(0).toFixed(2);

    return {
      branchId,
      totalTables,
      occupiedTables,
      openSessions,
      todayRevenue: todayAmount.toFixed(2),
      todayPaymentsCount: todayPayments.length,
      averageTicket,
      dailySeries: this.buildDailySeries(
        seriesRange.start,
        seriesRange.end,
        seriesPayments,
      ),
      ordersByStatus: orderGroups.sort((a, b) => b.count - a.count),
      topItems: topItems.map((item) => ({
        name: item.name,
        quantity: item.quantity,
        amount: (item.amount ?? new Prisma.Decimal(0)).toFixed(2),
      })),
    };
  }

  private resolveCustomRange(
    query: GetBranchSummaryQueryDto,
  ): ResolvedRange | null {
    if (!query.from && !query.to) {
      return null;
    }

    if (!query.from || !query.to) {
      throw new BadRequestException(
        'Debes indicar "from" y "to" juntos, o ninguno de los dos.',
      );
    }

    const start = new Date(`${query.from}T00:00:00.000`);
    const end = new Date(`${query.to}T23:59:59.999`);

    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      throw new BadRequestException(
        'El rango de fechas indicado no es valido.',
      );
    }

    if (start > end) {
      throw new BadRequestException('"from" debe ser anterior o igual a "to".');
    }

    const spanDays =
      Math.floor((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000)) + 1;

    if (spanDays > MAX_RANGE_DAYS) {
      throw new BadRequestException(
        `El rango no puede superar ${MAX_RANGE_DAYS} dias.`,
      );
    }

    return { start, end };
  }

  private daysBefore(date: Date, days: number): Date {
    const result = new Date(date);
    result.setDate(result.getDate() - days);
    return result;
  }

  private endOfDay(date: Date): Date {
    const result = new Date(date);
    result.setDate(result.getDate() + 1);
    result.setMilliseconds(-1);
    return result;
  }

  private buildDailySeries(
    rangeStart: Date,
    rangeEnd: Date,
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

    const series: DailyPaymentsMetricDto[] = [];
    const cursor = new Date(rangeStart);
    cursor.setHours(0, 0, 0, 0);
    const lastDay = new Date(rangeEnd);
    lastDay.setHours(0, 0, 0, 0);

    while (cursor <= lastDay) {
      const dateKey = this.toDateKey(cursor);
      const totals = totalsByDate.get(dateKey);

      series.push({
        date: dateKey,
        amount: (totals?.amount ?? new Prisma.Decimal(0)).toFixed(2),
        count: totals?.count ?? 0,
      });

      cursor.setDate(cursor.getDate() + 1);
    }

    return series;
  }

  private toDateKey(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');

    return `${year}-${month}-${day}`;
  }
}

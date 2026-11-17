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
import {
  DEFAULT_RESTAURANT_TIMEZONE,
  addDaysToDateKey,
  daysBetweenDateKeys,
  isDateKey,
  zonedDateKey,
  zonedStartOfDay,
} from '../../../common/time/restaurant-time';

const DEFAULT_SERIES_DAYS = 7;
const DEFAULT_TOP_ITEMS_WINDOW_DAYS = 30;
const MAX_RANGE_DAYS = 92;

type ResolvedRange = { start: Date; end: Date };

const ONE_MILLISECOND = 1;

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

    const timeZone =
      (await this.branchAnalyticsRepository.findBranchTimezone(branchId)) ??
      DEFAULT_RESTAURANT_TIMEZONE;
    const todayKey = zonedDateKey(new Date(), timeZone);
    const todayRange = this.rangeFromKeys(todayKey, todayKey, timeZone);

    const customRange = this.resolveCustomRange(query, timeZone);

    const seriesRange: ResolvedRange =
      customRange ??
      this.rangeFromKeys(
        addDaysToDateKey(todayKey, -(DEFAULT_SERIES_DAYS - 1)),
        todayKey,
        timeZone,
      );
    const ordersByStatusRange: ResolvedRange = customRange ?? todayRange;
    const topItemsRange: ResolvedRange =
      customRange ??
      this.rangeFromKeys(
        addDaysToDateKey(todayKey, -(DEFAULT_TOP_ITEMS_WINDOW_DAYS - 1)),
        todayKey,
        timeZone,
      );

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
        todayRange.start,
        todayRange.end,
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
      dailySeries: this.buildDailySeries(seriesRange, seriesPayments, timeZone),
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
    timeZone: string,
  ): ResolvedRange | null {
    if (!query.from && !query.to) {
      return null;
    }

    if (!query.from || !query.to) {
      throw new BadRequestException(
        'Debes indicar "from" y "to" juntos, o ninguno de los dos.',
      );
    }

    const fromKey = query.from.slice(0, 10);
    const toKey = query.to.slice(0, 10);

    if (!isDateKey(fromKey) || !isDateKey(toKey)) {
      throw new BadRequestException(
        'El rango de fechas indicado no es valido.',
      );
    }

    if (fromKey > toKey) {
      throw new BadRequestException('"from" debe ser anterior o igual a "to".');
    }

    if (daysBetweenDateKeys(fromKey, toKey) + 1 > MAX_RANGE_DAYS) {
      throw new BadRequestException(
        `El rango no puede superar ${MAX_RANGE_DAYS} dias.`,
      );
    }

    return this.rangeFromKeys(fromKey, toKey, timeZone);
  }

  private rangeFromKeys(
    fromKey: string,
    toKey: string,
    timeZone: string,
  ): ResolvedRange {
    return {
      start: zonedStartOfDay(fromKey, timeZone),
      end: new Date(
        zonedStartOfDay(addDaysToDateKey(toKey, 1), timeZone).getTime() -
          ONE_MILLISECOND,
      ),
    };
  }

  private buildDailySeries(
    range: ResolvedRange,
    payments: PaidPaymentRecord[],
    timeZone: string,
  ): DailyPaymentsMetricDto[] {
    const totalsByDate = new Map<
      string,
      { amount: Prisma.Decimal; count: number }
    >();

    for (const payment of payments) {
      const dateKey = zonedDateKey(
        payment.paidAt ?? payment.createdAt,
        timeZone,
      );
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
    const lastKey = zonedDateKey(range.end, timeZone);

    for (
      let dateKey = zonedDateKey(range.start, timeZone);
      dateKey <= lastKey;
      dateKey = addDaysToDateKey(dateKey, 1)
    ) {
      const totals = totalsByDate.get(dateKey);

      series.push({
        date: dateKey,
        amount: (totals?.amount ?? new Prisma.Decimal(0)).toFixed(2),
        count: totals?.count ?? 0,
      });
    }

    return series;
  }
}

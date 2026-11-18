import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import type { JwtPayload } from '../../auth/interfaces/jwt-payload.interface';
import { BranchAnalyticsPrismaRepository } from '../infrastructure/prisma/branch-analytics.prisma.repository';
import { EMPTY_FILTERS } from '../../reports/application/report-types';
import {
  ReportsInsightsPrismaRepository,
  type PeriodBucketRecord,
} from '../../reports/infrastructure/reports-insights.prisma.repository';
import type { BillFilter } from '../../reports/infrastructure/report-sql';
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
    private readonly insightsRepository: ReportsInsightsPrismaRepository,
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

    const seriesCoversToday =
      zonedDateKey(seriesRange.start, timeZone) <= todayKey &&
      todayKey <= zonedDateKey(seriesRange.end, timeZone);

    const [
      totalTables,
      occupiedTables,
      openSessions,
      seriesBuckets,
      todayBuckets,
      orderGroups,
      topItems,
    ] = await Promise.all([
      this.branchAnalyticsRepository.countTables(branchId),
      this.branchAnalyticsRepository.countOccupiedTables(branchId),
      this.branchAnalyticsRepository.countOpenSessions(branchId),
      this.insightsRepository.findPeriodBuckets(
        this.billFilter(branchId, seriesRange, timeZone),
        'day',
      ),
      seriesCoversToday
        ? Promise.resolve<PeriodBucketRecord[] | null>(null)
        : this.insightsRepository.findPeriodBuckets(
            this.billFilter(branchId, todayRange, timeZone),
            'day',
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

    const todayBucket = (todayBuckets ?? seriesBuckets).find(
      (bucket) => bucket.bucket === todayKey,
    );
    const todayGross = new Prisma.Decimal(todayBucket?.amount ?? 0);
    const todayRefunded = new Prisma.Decimal(todayBucket?.refunded ?? 0);
    const todayAmount = todayGross.minus(todayRefunded);
    const todayBills = todayBucket?.bills ?? 0;
    const averageTicket =
      todayBills > 0 && todayAmount.gt(0)
        ? todayAmount.dividedBy(todayBills)
        : new Prisma.Decimal(0);

    return {
      branchId,
      totalTables,
      occupiedTables,
      openSessions,
      todayRevenue: todayAmount.toFixed(2),
      todayRefunded: todayRefunded.toFixed(2),
      todayPaymentsCount: todayBills,
      averageTicket: averageTicket.toFixed(2),
      dailySeries: this.buildDailySeries(seriesRange, seriesBuckets, timeZone),
      ordersByStatus: orderGroups.sort((a, b) => b.count - a.count),
      topItems: topItems.map((item) => ({
        name: item.name,
        quantity: item.quantity,
        amount: (item.amount ?? new Prisma.Decimal(0)).toFixed(2),
      })),
    };
  }

  private billFilter(
    branchId: string,
    range: ResolvedRange,
    timeZone: string,
  ): BillFilter {
    return {
      ...EMPTY_FILTERS,
      branchId,
      start: range.start,
      end: new Date(range.end.getTime() + ONE_MILLISECOND),
      timeZone,
      cashierId: null,
      methods: [],
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
    buckets: PeriodBucketRecord[],
    timeZone: string,
  ): DailyPaymentsMetricDto[] {
    const byDate = new Map(buckets.map((bucket) => [bucket.bucket, bucket]));
    const series: DailyPaymentsMetricDto[] = [];
    const lastKey = zonedDateKey(range.end, timeZone);

    for (
      let dateKey = zonedDateKey(range.start, timeZone);
      dateKey <= lastKey;
      dateKey = addDaysToDateKey(dateKey, 1)
    ) {
      const bucket = byDate.get(dateKey);
      const refunded = new Prisma.Decimal(bucket?.refunded ?? 0);

      series.push({
        date: dateKey,
        amount: new Prisma.Decimal(bucket?.amount ?? 0)
          .minus(refunded)
          .toFixed(2),
        count: bucket?.bills ?? 0,
        refunded: refunded.toFixed(2),
      });
    }

    return series;
  }
}

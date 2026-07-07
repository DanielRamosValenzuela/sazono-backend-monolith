import { Injectable } from '@nestjs/common';
import { PaymentStatus, Prisma, RestaurantStatus } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type {
  MonthlyPaymentsMetricDto,
  PlatformMetricsResponseDto,
  TopRestaurantMetricDto,
} from '../presentation/http/dto/platform-metrics.dto';

type MonthlyPaymentsRow = {
  month: string;
  amount: Prisma.Decimal | null;
  count: number;
};

type TopRestaurantRow = {
  restaurantId: string;
  name: string;
  amount: Prisma.Decimal | null;
  count: number;
};

const MONTHLY_PAYMENTS_MONTHS = 12;
const TOP_RESTAURANTS_LIMIT = 5;

@Injectable()
export class GetPlatformMetricsService {
  constructor(private readonly prisma: PrismaService) {}

  async execute(): Promise<PlatformMetricsResponseDto> {
    const now = new Date();
    const monthlyRangeStart = new Date(
      now.getFullYear(),
      now.getMonth() - (MONTHLY_PAYMENTS_MONTHS - 1),
      1,
    );

    const [
      restaurants,
      activeRestaurants,
      branches,
      staffUsers,
      paymentsAggregate,
      monthlyRows,
      topRestaurantRows,
    ] = await Promise.all([
      this.prisma.restaurant.count(),
      this.prisma.restaurant.count({
        where: {
          status: RestaurantStatus.ACTIVE,
        },
      }),
      this.prisma.branch.count(),
      this.prisma.staffUser.count(),
      this.prisma.payment.aggregate({
        where: {
          status: PaymentStatus.PAID,
        },
        _sum: {
          amount: true,
        },
        _count: {
          _all: true,
        },
      }),
      this.prisma.$queryRaw<MonthlyPaymentsRow[]>`
        SELECT
          to_char(date_trunc('month', COALESCE(p.paid_at, p.created_at)), 'YYYY-MM') AS month,
          SUM(p.amount) AS amount,
          COUNT(p.id)::int AS count
        FROM payments p
        WHERE p.status = 'PAID'
          AND COALESCE(p.paid_at, p.created_at) >= ${monthlyRangeStart}
        GROUP BY 1
        ORDER BY 1
      `,
      this.prisma.$queryRaw<TopRestaurantRow[]>`
        SELECT
          r.id AS "restaurantId",
          r.name AS name,
          SUM(p.amount) AS amount,
          COUNT(p.id)::int AS count
        FROM payments p
        INNER JOIN bills b ON b.id = p.bill_id
        INNER JOIN branches br ON br.id = b.branch_id
        INNER JOIN restaurants r ON r.id = br.restaurant_id
        WHERE p.status = 'PAID'
        GROUP BY r.id, r.name
        ORDER BY SUM(p.amount) DESC
        LIMIT ${TOP_RESTAURANTS_LIMIT}
      `,
    ]);

    return {
      totals: {
        restaurants,
        activeRestaurants,
        branches,
        staffUsers,
        paymentsAmount: (
          paymentsAggregate._sum.amount ?? new Prisma.Decimal(0)
        ).toFixed(2),
        paymentsCount: paymentsAggregate._count._all,
      },
      monthlyPayments: this.buildMonthlyPayments(now, monthlyRows),
      topRestaurants: topRestaurantRows.map((row): TopRestaurantMetricDto => ({
        restaurantId: row.restaurantId,
        name: row.name,
        amount: (row.amount ?? new Prisma.Decimal(0)).toFixed(2),
        count: row.count,
      })),
    };
  }

  private buildMonthlyPayments(
    now: Date,
    rows: MonthlyPaymentsRow[],
  ): MonthlyPaymentsMetricDto[] {
    const rowsByMonth = new Map(rows.map((row) => [row.month, row]));
    const monthlyPayments: MonthlyPaymentsMetricDto[] = [];

    for (
      let monthsAgo = MONTHLY_PAYMENTS_MONTHS - 1;
      monthsAgo >= 0;
      monthsAgo -= 1
    ) {
      const monthDate = new Date(
        now.getFullYear(),
        now.getMonth() - monthsAgo,
        1,
      );
      const month = `${monthDate.getFullYear()}-${String(
        monthDate.getMonth() + 1,
      ).padStart(2, '0')}`;
      const row = rowsByMonth.get(month);

      monthlyPayments.push({
        month,
        amount: (row?.amount ?? new Prisma.Decimal(0)).toFixed(2),
        count: row?.count ?? 0,
      });
    }

    return monthlyPayments;
  }
}

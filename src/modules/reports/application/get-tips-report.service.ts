import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  addDaysToDateKey,
  daysBetweenDateKeys,
  zonedDateKey,
} from '../../../common/time/restaurant-time';
import type { JwtPayload } from '../../auth/interfaces/jwt-payload.interface';
import {
  CARD_TIP_METHODS,
  ReportsInsightsPrismaRepository,
  type TipDayRecord,
  type TipPayoutRecord,
} from '../infrastructure/reports-insights.prisma.repository';
import type { CsvDownload } from './get-sales-by-order.service';
import {
  ZERO,
  money,
  percent,
  resolveInsightsScope,
  rowsCsv,
  toBillFilter,
  type InsightsQuery,
} from './insights-shared';
import { ReportScopeService } from './report-scope.service';
import { CAJA_UNASSIGNED_LABEL } from './report-types';

export const CARD_TIP_PAYOUT_BUSINESS_DAYS = 7;

export type TipPayoutStatus = 'NO_CARD_TIPS' | 'PENDING' | 'OVERDUE';

export type TipWaiterRow = {
  staffId: string | null;
  name: string;
  bills: number;
  sales: string;
  tip: string;
  tipPercent: number;
  returned: string;
  tipOwed: string;
  cashTip: string;
  cardTip: string;
  otherTip: string;
  cardTipPending: string;
  cardTipOverdue: string;
  oldestCardTipDate: string | null;
  oldestCardTipDueDate: string | null;
  oldestCardTipAgeDays: number | null;
  payoutStatus: TipPayoutStatus;
};

export type TipDayRow = {
  date: string;
  bills: number;
  sales: string;
  tip: string;
  tipPercent: number;
  returned: string;
};

export type TipsResponse = {
  from: string;
  to: string;
  timeZone: string;
  cashierId: string | null;
  totals: {
    bills: number;
    sales: string;
    tip: string;
    tipPercent: number;
    returned: string;
    tipOwed: string;
  };
  byWaiter: TipWaiterRow[];
  byDay: TipDayRow[];
  payout: {
    businessDays: number;
    cardMethods: string[];
    asOf: string;
    cardTipPending: string;
    cardTipOverdue: string;
    overdueWaiters: number;
  };
};

export const TIPS_CSV_HEADERS = [
  'Mesero',
  'Cuentas',
  'Ventas',
  'Propina',
  '% sobre venta',
  'Devuelta',
  'Propina a pagar',
  'Propina efectivo',
  'Propina tarjeta',
  'Propina otros medios',
  'Tarjeta en plazo',
  'Tarjeta vencida',
  'Tarjeta mas antigua',
  'Vence',
  'Dias de antiguedad',
  'Estado',
];

export function addBusinessDays(dateKey: string, days: number): string {
  let current = dateKey;
  let remaining = days;

  while (remaining > 0) {
    current = addDaysToDateKey(current, 1);
    const weekday = new Date(`${current}T00:00:00.000Z`).getUTCDay();

    if (weekday !== 0 && weekday !== 6) {
      remaining -= 1;
    }
  }

  return current;
}

type WaiterAccumulator = {
  staffId: string | null;
  name: string;
  bills: number;
  sales: Prisma.Decimal;
  tip: Prisma.Decimal;
  returned: Prisma.Decimal;
  cashTip: Prisma.Decimal;
  cardTip: Prisma.Decimal;
  otherTip: Prisma.Decimal;
  cardPending: Prisma.Decimal;
  cardOverdue: Prisma.Decimal;
  oldestCardDate: string | null;
};

export function buildTips(
  days: TipDayRecord[],
  payouts: TipPayoutRecord[],
  today: string,
): Pick<TipsResponse, 'totals' | 'byWaiter' | 'byDay' | 'payout'> {
  const waiters = new Map<string, WaiterAccumulator>();
  const byDay = new Map<
    string,
    {
      bills: number;
      sales: Prisma.Decimal;
      tip: Prisma.Decimal;
      returned: Prisma.Decimal;
    }
  >();
  let totalBills = 0;
  let totalSales = ZERO;
  let totalTip = ZERO;
  let totalReturned = ZERO;

  const waiterOf = (
    staffId: string | null,
    name: string | null,
  ): WaiterAccumulator => {
    const key = staffId ?? '';
    let waiter = waiters.get(key);

    if (!waiter) {
      waiter = {
        staffId,
        name: name ?? CAJA_UNASSIGNED_LABEL,
        bills: 0,
        sales: ZERO,
        tip: ZERO,
        returned: ZERO,
        cashTip: ZERO,
        cardTip: ZERO,
        otherTip: ZERO,
        cardPending: ZERO,
        cardOverdue: ZERO,
        oldestCardDate: null,
      };
      waiters.set(key, waiter);
    }

    return waiter;
  };

  for (const record of days) {
    const sales = new Prisma.Decimal(record.sales);
    const tip = new Prisma.Decimal(record.tip);
    const returned = new Prisma.Decimal(record.returned);
    const waiter = waiterOf(record.staff_id, record.name);
    const day = byDay.get(record.day) ?? {
      bills: 0,
      sales: ZERO,
      tip: ZERO,
      returned: ZERO,
    };

    waiter.bills += record.bills;
    waiter.sales = waiter.sales.add(sales);
    waiter.tip = waiter.tip.add(tip);
    waiter.returned = waiter.returned.add(returned);
    byDay.set(record.day, {
      bills: day.bills + record.bills,
      sales: day.sales.add(sales),
      tip: day.tip.add(tip),
      returned: day.returned.add(returned),
    });
    totalBills += record.bills;
    totalSales = totalSales.add(sales);
    totalTip = totalTip.add(tip);
    totalReturned = totalReturned.add(returned);
  }

  for (const record of payouts) {
    const waiter = waiters.get(record.staff_id ?? '');

    if (!waiter) {
      continue;
    }

    const card = new Prisma.Decimal(record.card_tip);
    const cardOwed = new Prisma.Decimal(record.card_tip_owed);
    const cash = new Prisma.Decimal(record.cash_tip);
    const total = new Prisma.Decimal(record.total_tip);

    waiter.cardTip = waiter.cardTip.add(card);
    waiter.cashTip = waiter.cashTip.add(cash);
    waiter.otherTip = waiter.otherTip.add(total.sub(card).sub(cash));

    if (cardOwed.gt(0)) {
      const due = addBusinessDays(
        record.paid_day,
        CARD_TIP_PAYOUT_BUSINESS_DAYS,
      );

      if (due < today) {
        waiter.cardOverdue = waiter.cardOverdue.add(cardOwed);
      } else {
        waiter.cardPending = waiter.cardPending.add(cardOwed);
      }

      if (
        waiter.oldestCardDate === null ||
        record.paid_day < waiter.oldestCardDate
      ) {
        waiter.oldestCardDate = record.paid_day;
      }
    }
  }

  const byWaiter = [...waiters.values()]
    .sort(
      (a, b) => b.tip.comparedTo(a.tip) || a.name.localeCompare(b.name, 'es'),
    )
    .map((waiter): TipWaiterRow => {
      const due = waiter.oldestCardDate
        ? addBusinessDays(waiter.oldestCardDate, CARD_TIP_PAYOUT_BUSINESS_DAYS)
        : null;
      let payoutStatus: TipPayoutStatus = 'NO_CARD_TIPS';

      if (waiter.oldestCardDate) {
        payoutStatus = waiter.cardOverdue.gt(0) ? 'OVERDUE' : 'PENDING';
      }

      return {
        staffId: waiter.staffId,
        name: waiter.name,
        bills: waiter.bills,
        sales: money(waiter.sales),
        tip: money(waiter.tip),
        tipPercent: percent(waiter.tip, waiter.sales),
        returned: money(waiter.returned),
        tipOwed: money(waiter.tip.sub(waiter.returned)),
        cashTip: money(waiter.cashTip),
        cardTip: money(waiter.cardTip),
        otherTip: money(waiter.otherTip),
        cardTipPending: money(waiter.cardPending),
        cardTipOverdue: money(waiter.cardOverdue),
        oldestCardTipDate: waiter.oldestCardDate,
        oldestCardTipDueDate: due,
        oldestCardTipAgeDays: waiter.oldestCardDate
          ? daysBetweenDateKeys(waiter.oldestCardDate, today)
          : null,
        payoutStatus,
      };
    });

  const sumWaiters = (pick: (waiter: WaiterAccumulator) => Prisma.Decimal) =>
    [...waiters.values()].reduce(
      (total, waiter) => total.add(pick(waiter)),
      ZERO,
    );

  return {
    totals: {
      bills: totalBills,
      sales: money(totalSales),
      tip: money(totalTip),
      tipPercent: percent(totalTip, totalSales),
      returned: money(totalReturned),
      tipOwed: money(totalTip.sub(totalReturned)),
    },
    byWaiter,
    byDay: [...byDay.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, day]) => ({
        date,
        bills: day.bills,
        sales: money(day.sales),
        tip: money(day.tip),
        tipPercent: percent(day.tip, day.sales),
        returned: money(day.returned),
      })),
    payout: {
      businessDays: CARD_TIP_PAYOUT_BUSINESS_DAYS,
      cardMethods: [...CARD_TIP_METHODS],
      asOf: today,
      cardTipPending: money(sumWaiters((waiter) => waiter.cardPending)),
      cardTipOverdue: money(sumWaiters((waiter) => waiter.cardOverdue)),
      overdueWaiters: byWaiter.filter((row) => row.payoutStatus === 'OVERDUE')
        .length,
    },
  };
}

@Injectable()
export class GetTipsReportService {
  constructor(
    private readonly scopeService: ReportScopeService,
    private readonly insightsRepository: ReportsInsightsPrismaRepository,
  ) {}

  async execute(
    authUser: JwtPayload,
    branchId: string,
    query: InsightsQuery,
  ): Promise<TipsResponse> {
    const { scope, response } = await this.load(
      authUser,
      branchId,
      query,
      false,
    );

    return {
      from: scope.from,
      to: scope.to,
      timeZone: scope.timeZone,
      cashierId: scope.cashierId,
      ...response,
    };
  }

  async executeCsv(
    authUser: JwtPayload,
    branchId: string,
    query: InsightsQuery,
  ): Promise<CsvDownload> {
    const { scope, response } = await this.load(
      authUser,
      branchId,
      query,
      true,
    );
    const { byWaiter, totals } = response;

    return rowsCsv(
      `propinas_${branchId}_${scope.from}_${scope.to}.csv`,
      TIPS_CSV_HEADERS,
      [
        ...byWaiter.map((row) => [
          row.name,
          row.bills,
          Number(row.sales),
          Number(row.tip),
          row.tipPercent,
          Number(row.returned),
          Number(row.tipOwed),
          Number(row.cashTip),
          Number(row.cardTip),
          Number(row.otherTip),
          Number(row.cardTipPending),
          Number(row.cardTipOverdue),
          row.oldestCardTipDate,
          row.oldestCardTipDueDate,
          row.oldestCardTipAgeDays,
          row.payoutStatus,
        ]),
        [
          'TOTAL',
          totals.bills,
          Number(totals.sales),
          Number(totals.tip),
          totals.tipPercent,
          Number(totals.returned),
          Number(totals.tipOwed),
          null,
          null,
          null,
          Number(response.payout.cardTipPending),
          Number(response.payout.cardTipOverdue),
          null,
          null,
          null,
          null,
        ],
      ],
    );
  }

  private async load(
    authUser: JwtPayload,
    branchId: string,
    query: InsightsQuery,
    forCsv: boolean,
  ) {
    const scope = await resolveInsightsScope(
      this.scopeService,
      authUser,
      branchId,
      query,
      forCsv,
    );
    const filter = toBillFilter(scope);
    const [days, payouts] = await Promise.all([
      this.insightsRepository.findTipsByWaiterDay(filter),
      this.insightsRepository.findTipPayouts(filter),
    ]);

    return {
      scope,
      response: buildTips(
        days,
        payouts,
        zonedDateKey(new Date(), scope.timeZone),
      ),
    };
  }
}

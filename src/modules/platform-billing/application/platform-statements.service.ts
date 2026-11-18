import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, PlatformFeeStatementStatus } from '@prisma/client';
import { Readable } from 'node:stream';
import { PrismaService } from '../../../common/prisma/prisma.service';
import {
  DEFAULT_RESTAURANT_TIMEZONE,
  zonedDateKey,
} from '../../../common/time/restaurant-time';
import { csvStream, type CsvCell } from '../../reports/application/report-csv';
import {
  computeFee,
  isPeriod,
  periodBounds,
  shiftPeriod,
} from '../domain/fee-calculation';

const ZERO = new Prisma.Decimal(0);
const MAX_CARRY_MONTHS = 12;

export const STATEMENT_CSV_HEADERS = [
  'Periodo',
  'Restaurante',
  'RUT/Razon social',
  'Sucursales',
  'Ventas brutas',
  'Propinas',
  'Descuentos',
  'Reembolsos',
  'Arrastre',
  'Ventas netas',
  'Comision',
  'Estado',
];

const STATUS_LABELS: Record<PlatformFeeStatementStatus, string> = {
  DRAFT: 'Borrador',
  ISSUED: 'Emitido',
  PAID: 'Pagado',
  WAIVED: 'Exonerado',
  VOID: 'Anulado',
};

const ALLOWED_TRANSITIONS: Record<
  PlatformFeeStatementStatus,
  PlatformFeeStatementStatus[]
> = {
  DRAFT: [],
  ISSUED: ['PAID', 'WAIVED', 'VOID'],
  PAID: ['VOID'],
  WAIVED: ['VOID'],
  VOID: [],
};

type RestaurantRecord = {
  id: string;
  name: string;
  legalName: string | null;
  taxId: string | null;
  timezone: string;
  platformFeeBps: number;
};

type Figures = {
  gross: Prisma.Decimal;
  tips: Prisma.Decimal;
  refunds: Prisma.Decimal;
};

type BranchFigures = Figures & { branchId: string; name: string };

type GroupedFigures = Figures & { key: string };

type PaymentAggregateRow = {
  key: string;
  gross: Prisma.Decimal.Value;
  tips: Prisma.Decimal.Value;
};

type RefundAggregateRow = { key: string; refunds: Prisma.Decimal.Value };

type StoredBreakdown = {
  branches: StatementBranch[];
  days: StatementGroup[];
  methods: StatementGroup[];
};

export type StatementBranch = {
  branchId: string;
  name: string;
  grossSales: string;
  tipsTotal: string;
  refunds: string;
  netSales: string;
};

export type StatementGroup = {
  key: string;
  grossSales: string;
  tipsTotal: string;
  refunds: string;
  netSales: string;
};

export type StatementRow = {
  restaurantId: string;
  restaurantName: string;
  legalName: string | null;
  taxId: string | null;
  period: string;
  branches: { branchId: string; name: string; netSales: string }[];
  grossSales: string;
  tipsTotal: string;
  refunds: string;
  discounts: string;
  carryOver: string;
  netSales: string;
  feeBps: number;
  feeAmount: string;
  status: PlatformFeeStatementStatus;
  frozen: boolean;
  notes: string | null;
  issuedAt: string | null;
  paidAt: string | null;
};

export type StatementTotals = {
  grossSales: string;
  tipsTotal: string;
  refunds: string;
  discounts: string;
  carryOver: string;
  netSales: string;
  feeAmount: string;
};

export type StatementsListResponse = {
  period: string;
  rows: StatementRow[];
  totals: StatementTotals;
};

export type StatementDetailResponse = {
  statement: StatementRow;
  branches: StatementBranch[];
  days: StatementGroup[];
  methods: StatementGroup[];
};

export type FinalizeResponse = {
  period: string;
  finalized: number;
  alreadyFrozen: number;
};

export type StatementCsvDownload = { filename: string; stream: Readable };

type LiveStatement = {
  row: StatementRow;
  figures: {
    gross: Prisma.Decimal;
    tips: Prisma.Decimal;
    refunds: Prisma.Decimal;
    carryOver: Prisma.Decimal;
    net: Prisma.Decimal;
    fee: Prisma.Decimal;
  };
  branches: BranchFigures[];
};

type StoredStatement = Prisma.PlatformFeeStatementGetPayload<object>;

const money = (value: Prisma.Decimal): string => value.toFixed(2);

function toDecimal(
  value: Prisma.Decimal.Value | null | undefined,
): Prisma.Decimal {
  return new Prisma.Decimal(value ?? 0);
}

function periodMonthDate(period: string): Date {
  return new Date(`${period}-01T00:00:00.000Z`);
}

function sumDecimals(values: Prisma.Decimal[]): Prisma.Decimal {
  return values.reduce((acc, value) => acc.plus(value), ZERO);
}

@Injectable()
export class PlatformStatementsService {
  constructor(private readonly prisma: PrismaService) {}

  currentPeriod(now = new Date()): string {
    return zonedDateKey(now, DEFAULT_RESTAURANT_TIMEZONE).slice(0, 7);
  }

  async list(period: string): Promise<StatementsListResponse> {
    this.assertPeriod(period);
    const restaurants = await this.loadRestaurants(period);
    const stored = await this.loadStored(period, restaurants);
    const live = await this.computeLive(
      restaurants.filter((r) => !this.isFrozen(stored.get(r.id))),
      period,
    );
    const rows = restaurants.map((restaurant) => {
      const frozen = stored.get(restaurant.id);

      return this.isFrozen(frozen) && frozen
        ? this.rowFromStored(restaurant, period, frozen)
        : (live.get(restaurant.id) as LiveStatement).row;
    });

    return { period, rows, totals: this.totals(rows) };
  }

  async detail(
    restaurantId: string,
    period: string,
  ): Promise<StatementDetailResponse> {
    this.assertPeriod(period);
    const restaurant = await this.requireRestaurant(restaurantId);
    const stored = (await this.loadStored(period, [restaurant])).get(
      restaurant.id,
    );

    if (this.isFrozen(stored) && stored) {
      const breakdown = this.readBreakdown(stored);

      return {
        statement: this.rowFromStored(restaurant, period, stored),
        ...breakdown,
      };
    }

    const { live, breakdown } = await this.computeWithBreakdown(
      restaurant,
      period,
    );

    return { statement: live.row, ...breakdown };
  }

  async finalize(period: string): Promise<FinalizeResponse> {
    this.assertPeriod(period);

    if (periodBounds(period, DEFAULT_RESTAURANT_TIMEZONE).end > new Date()) {
      throw new BadRequestException(
        'El mes aun no termina; solo se pueden finalizar meses cerrados.',
      );
    }

    const restaurants = await this.loadBillableRestaurants(period);
    let finalized = 0;

    for (const restaurant of restaurants) {
      const { live, breakdown } = await this.computeWithBreakdown(
        restaurant,
        period,
      );
      finalized += await this.upsertStatement(
        restaurant,
        period,
        live,
        'ISSUED',
        breakdown,
      );
    }

    return { period, finalized, alreadyFrozen: restaurants.length - finalized };
  }

  async createDrafts(period: string): Promise<number> {
    this.assertPeriod(period);
    const restaurants = await this.loadBillableRestaurants(period);
    const live = await this.computeLive(restaurants, period);
    let created = 0;

    for (const restaurant of restaurants) {
      created += await this.upsertStatement(
        restaurant,
        period,
        live.get(restaurant.id) as LiveStatement,
        'DRAFT',
        null,
      );
    }

    return created;
  }

  async updateStatus(
    restaurantId: string,
    period: string,
    status: PlatformFeeStatementStatus,
    notes: string | undefined,
  ): Promise<StatementRow> {
    this.assertPeriod(period);
    const restaurant = await this.requireRestaurant(restaurantId);
    const stored = await this.prisma.platformFeeStatement.findUnique({
      where: {
        restaurantId_periodMonth: {
          restaurantId,
          periodMonth: periodMonthDate(period),
        },
      },
    });

    if (!stored) {
      throw new NotFoundException(
        'No existe un estado de cuenta emitido para ese periodo.',
      );
    }

    if (!ALLOWED_TRANSITIONS[stored.status].includes(status)) {
      throw new BadRequestException(
        `Transicion no permitida: ${stored.status} -> ${status}.`,
      );
    }

    const trimmed = notes?.trim();

    if (status !== 'PAID' && !trimmed) {
      throw new BadRequestException(
        'Las notas son obligatorias para exonerar o anular.',
      );
    }

    const updated = await this.prisma.platformFeeStatement.update({
      where: { id: stored.id },
      data: {
        status,
        notes: trimmed || stored.notes,
        paidAt: status === 'PAID' ? new Date() : stored.paidAt,
      },
    });

    return this.rowFromStored(restaurant, period, updated);
  }

  async exportCsv(period: string): Promise<StatementCsvDownload> {
    const { rows } = await this.list(period);
    const integer = (value: string): number =>
      Number(new Prisma.Decimal(value).toFixed(0));

    const cells: CsvCell[][] = rows.map((row) => [
      row.period,
      row.restaurantName,
      [row.taxId, row.legalName ?? row.restaurantName]
        .filter(Boolean)
        .join(' - '),
      row.branches.map((branch) => branch.name).join(', '),
      integer(row.grossSales),
      integer(row.tipsTotal),
      integer(row.discounts),
      integer(row.refunds),
      integer(row.carryOver),
      integer(row.netSales),
      integer(row.feeAmount),
      STATUS_LABELS[row.status],
    ]);

    return {
      filename: `estado-de-cuenta-${period}.csv`,
      stream: csvStream(STATEMENT_CSV_HEADERS, Readable.from(cells)),
    };
  }

  private assertPeriod(period: string): void {
    if (!isPeriod(period)) {
      throw new BadRequestException('El periodo debe tener formato YYYY-MM.');
    }
  }

  private isFrozen(stored: StoredStatement | undefined): boolean {
    return !!stored && stored.status !== 'DRAFT';
  }

  private async requireRestaurant(id: string): Promise<RestaurantRecord> {
    const restaurant = await this.prisma.restaurant.findUnique({
      where: { id },
      select: this.restaurantSelect,
    });

    if (!restaurant) {
      throw new NotFoundException('Restaurante no encontrado.');
    }

    return restaurant;
  }

  private readonly restaurantSelect = {
    id: true,
    name: true,
    legalName: true,
    taxId: true,
    timezone: true,
    platformFeeBps: true,
  } as const;

  private loadRestaurants(period: string): Promise<RestaurantRecord[]> {
    return this.prisma.restaurant.findMany({
      where: {
        OR: [
          { status: 'ACTIVE' },
          {
            feeStatements: {
              some: { periodMonth: periodMonthDate(period) },
            },
          },
        ],
      },
      select: this.restaurantSelect,
      orderBy: { name: 'asc' },
    });
  }

  private async loadBillableRestaurants(
    period: string,
  ): Promise<RestaurantRecord[]> {
    const all = await this.prisma.restaurant.findMany({
      select: { ...this.restaurantSelect, status: true },
      orderBy: { name: 'asc' },
    });
    const keep = new Set(
      all.filter((r) => r.status === 'ACTIVE').map((r) => r.id),
    );
    const inactive = all.filter((r) => !keep.has(r.id));
    const byTimezone = new Map<string, RestaurantRecord[]>();

    for (const restaurant of inactive) {
      byTimezone.set(restaurant.timezone, [
        ...(byTimezone.get(restaurant.timezone) ?? []),
        restaurant,
      ]);
    }

    for (const [timezone, group] of byTimezone) {
      const { start, end } = periodBounds(period, timezone);
      const withActivity = await this.prisma.restaurant.findMany({
        where: {
          id: { in: group.map((r) => r.id) },
          branches: {
            some: {
              OR: [
                {
                  bills: {
                    some: {
                      payments: {
                        some: {
                          status: 'PAID',
                          paidAt: { gte: start, lt: end },
                        },
                      },
                    },
                  },
                },
                {
                  refunds: {
                    some: {
                      status: 'SUCCEEDED',
                      completedAt: { gte: start, lt: end },
                    },
                  },
                },
              ],
            },
          },
        },
        select: { id: true },
      });

      for (const row of withActivity) {
        keep.add(row.id);
      }
    }

    return all.filter((r) => keep.has(r.id));
  }

  private async loadStored(
    period: string,
    restaurants: RestaurantRecord[],
  ): Promise<Map<string, StoredStatement>> {
    const rows = await this.prisma.platformFeeStatement.findMany({
      where: {
        periodMonth: periodMonthDate(period),
        restaurantId: { in: restaurants.map((r) => r.id) },
      },
    });

    return new Map(rows.map((row) => [row.restaurantId, row]));
  }

  private async branchFigures(
    restaurants: RestaurantRecord[],
    period: string,
  ): Promise<Map<string, BranchFigures[]>> {
    const result = new Map<string, BranchFigures[]>();

    if (restaurants.length === 0) {
      return result;
    }

    const branches = await this.prisma.branch.findMany({
      where: { restaurantId: { in: restaurants.map((r) => r.id) } },
      select: { id: true, name: true, restaurantId: true },
      orderBy: { name: 'asc' },
    });
    const byTimezone = new Map<string, RestaurantRecord[]>();

    for (const restaurant of restaurants) {
      byTimezone.set(restaurant.timezone, [
        ...(byTimezone.get(restaurant.timezone) ?? []),
        restaurant,
      ]);
    }

    const totalsByBranch = new Map<string, Figures>();

    for (const [timezone, group] of byTimezone) {
      const { start, end } = periodBounds(period, timezone);
      const ids = group.map((r) => r.id);
      const payments = await this.prisma.$queryRaw<PaymentAggregateRow[]>(
        Prisma.sql`
          SELECT b.branch_id::text AS key,
                 COALESCE(SUM(p.amount - p.tip_amount), 0) AS gross,
                 COALESCE(SUM(p.tip_amount), 0) AS tips
          FROM payments p
          JOIN bills b ON b.id = p.bill_id
          JOIN branches br ON br.id = b.branch_id
          WHERE p.status = 'PAID'
            AND p.paid_at >= ${start} AND p.paid_at < ${end}
            AND br.restaurant_id = ANY(${ids}::uuid[])
          GROUP BY b.branch_id
        `,
      );
      const refunds = await this.prisma.$queryRaw<RefundAggregateRow[]>(
        Prisma.sql`
          SELECT r.branch_id::text AS key,
                 COALESCE(SUM(r.amount - r.tip_amount), 0) AS refunds
          FROM refunds r
          JOIN branches br ON br.id = r.branch_id
          WHERE r.status = 'SUCCEEDED'
            AND r.completed_at >= ${start} AND r.completed_at < ${end}
            AND br.restaurant_id = ANY(${ids}::uuid[])
          GROUP BY r.branch_id
        `,
      );

      for (const row of payments) {
        const entry = totalsByBranch.get(row.key) ?? {
          gross: ZERO,
          tips: ZERO,
          refunds: ZERO,
        };
        totalsByBranch.set(row.key, {
          ...entry,
          gross: toDecimal(row.gross),
          tips: toDecimal(row.tips),
        });
      }

      for (const row of refunds) {
        const entry = totalsByBranch.get(row.key) ?? {
          gross: ZERO,
          tips: ZERO,
          refunds: ZERO,
        };
        totalsByBranch.set(row.key, {
          ...entry,
          refunds: toDecimal(row.refunds),
        });
      }
    }

    for (const branch of branches) {
      const figures = totalsByBranch.get(branch.id) ?? {
        gross: ZERO,
        tips: ZERO,
        refunds: ZERO,
      };
      result.set(branch.restaurantId, [
        ...(result.get(branch.restaurantId) ?? []),
        { branchId: branch.id, name: branch.name, ...figures },
      ]);
    }

    return result;
  }

  private async carryOvers(
    restaurants: RestaurantRecord[],
    period: string,
    depth = 0,
  ): Promise<Map<string, Prisma.Decimal>> {
    const carry = new Map<string, Prisma.Decimal>();

    if (restaurants.length === 0 || depth >= MAX_CARRY_MONTHS) {
      return carry;
    }

    const previous = shiftPeriod(period, -1);
    const stored = await this.loadStored(previous, restaurants);
    const pending: RestaurantRecord[] = [];

    for (const restaurant of restaurants) {
      const row = stored.get(restaurant.id);

      if (row && row.status !== 'DRAFT') {
        carry.set(
          restaurant.id,
          row.status !== 'VOID' && row.netSales.isNegative()
            ? row.netSales
            : ZERO,
        );
      } else {
        pending.push(restaurant);
      }
    }

    const figures = await this.branchFigures(pending, previous);
    const earlier = await this.carryOvers(pending, previous, depth + 1);

    for (const restaurant of pending) {
      const branches = figures.get(restaurant.id) ?? [];
      carry.set(
        restaurant.id,
        computeFee({
          gross: sumDecimals(branches.map((b) => b.gross)),
          refunds: sumDecimals(branches.map((b) => b.refunds)),
          discounts: ZERO,
          carryOverIn: earlier.get(restaurant.id) ?? ZERO,
          feeBps: restaurant.platformFeeBps,
        }).carryOverOut,
      );
    }

    return carry;
  }

  private async computeLive(
    restaurants: RestaurantRecord[],
    period: string,
  ): Promise<Map<string, LiveStatement>> {
    const figures = await this.branchFigures(restaurants, period);
    const carry = await this.carryOvers(restaurants, period);

    return new Map(
      restaurants.map((restaurant) => [
        restaurant.id,
        this.buildLive(
          restaurant,
          period,
          figures.get(restaurant.id) ?? [],
          carry.get(restaurant.id) ?? ZERO,
        ),
      ]),
    );
  }

  private buildLive(
    restaurant: RestaurantRecord,
    period: string,
    branches: BranchFigures[],
    carryOver: Prisma.Decimal,
  ): LiveStatement {
    const gross = sumDecimals(branches.map((b) => b.gross));
    const tips = sumDecimals(branches.map((b) => b.tips));
    const refunds = sumDecimals(branches.map((b) => b.refunds));
    const result = computeFee({
      gross,
      refunds,
      discounts: ZERO,
      carryOverIn: carryOver,
      feeBps: restaurant.platformFeeBps,
    });

    return {
      branches,
      figures: {
        gross,
        tips,
        refunds,
        carryOver,
        net: result.netSales,
        fee: result.feeAmount,
      },
      row: {
        restaurantId: restaurant.id,
        restaurantName: restaurant.name,
        legalName: restaurant.legalName,
        taxId: restaurant.taxId,
        period,
        branches: branches.map((b) => ({
          branchId: b.branchId,
          name: b.name,
          netSales: money(b.gross.minus(b.refunds)),
        })),
        grossSales: money(gross),
        tipsTotal: money(tips),
        refunds: money(refunds),
        discounts: money(ZERO),
        carryOver: money(carryOver),
        netSales: money(result.netSales),
        feeBps: restaurant.platformFeeBps,
        feeAmount: money(result.feeAmount),
        status: 'DRAFT',
        frozen: false,
        notes: null,
        issuedAt: null,
        paidAt: null,
      },
    };
  }

  private rowFromStored(
    restaurant: RestaurantRecord,
    period: string,
    stored: StoredStatement,
  ): StatementRow {
    const breakdown = this.readBreakdown(stored);

    return {
      restaurantId: restaurant.id,
      restaurantName: restaurant.name,
      legalName: restaurant.legalName,
      taxId: restaurant.taxId,
      period,
      branches: breakdown.branches.map((b) => ({
        branchId: b.branchId,
        name: b.name,
        netSales: b.netSales,
      })),
      grossSales: money(stored.grossSales),
      tipsTotal: money(stored.tipsTotal),
      refunds: money(stored.refundsTotal),
      discounts: money(stored.discounts),
      carryOver: money(stored.carryOverIn),
      netSales: money(stored.netSales),
      feeBps: stored.feeBps,
      feeAmount: money(stored.feeAmount),
      status: stored.status,
      frozen: stored.status !== 'DRAFT',
      notes: stored.notes,
      issuedAt: stored.issuedAt?.toISOString() ?? null,
      paidAt: stored.paidAt?.toISOString() ?? null,
    };
  }

  private readBreakdown(stored: StoredStatement): StoredBreakdown {
    const raw = stored.breakdown as Partial<StoredBreakdown> | null;

    return {
      branches: raw?.branches ?? [],
      days: raw?.days ?? [],
      methods: raw?.methods ?? [],
    };
  }

  private async computeWithBreakdown(
    restaurant: RestaurantRecord,
    period: string,
  ): Promise<{ live: LiveStatement; breakdown: StoredBreakdown }> {
    const live = (await this.computeLive([restaurant], period)).get(
      restaurant.id,
    ) as LiveStatement;
    const { start, end } = periodBounds(period, restaurant.timezone);
    const days = await this.groupedFigures(restaurant, start, end, 'day');
    const methods = await this.groupedFigures(restaurant, start, end, 'method');
    const toGroup = (group: GroupedFigures): StatementGroup => ({
      key: group.key,
      grossSales: money(group.gross),
      tipsTotal: money(group.tips),
      refunds: money(group.refunds),
      netSales: money(group.gross.minus(group.refunds)),
    });

    return {
      live,
      breakdown: {
        branches: live.branches.map((b) => ({
          branchId: b.branchId,
          name: b.name,
          grossSales: money(b.gross),
          tipsTotal: money(b.tips),
          refunds: money(b.refunds),
          netSales: money(b.gross.minus(b.refunds)),
        })),
        days: days.map(toGroup),
        methods: methods.map(toGroup),
      },
    };
  }

  private async groupedFigures(
    restaurant: RestaurantRecord,
    start: Date,
    end: Date,
    by: 'day' | 'method',
  ): Promise<GroupedFigures[]> {
    const paymentKey =
      by === 'day'
        ? Prisma.sql`to_char(p.paid_at AT TIME ZONE ${restaurant.timezone}::text, 'YYYY-MM-DD')`
        : Prisma.sql`COALESCE(p.method::text, 'SIN_CLASIFICAR')`;
    const refundKey =
      by === 'day'
        ? Prisma.sql`to_char(r.completed_at AT TIME ZONE ${restaurant.timezone}::text, 'YYYY-MM-DD')`
        : Prisma.sql`COALESCE(p.method::text, 'SIN_CLASIFICAR')`;
    const payments = await this.prisma.$queryRaw<PaymentAggregateRow[]>(
      Prisma.sql`
        SELECT ${paymentKey} AS key,
               COALESCE(SUM(p.amount - p.tip_amount), 0) AS gross,
               COALESCE(SUM(p.tip_amount), 0) AS tips
        FROM payments p
        JOIN bills b ON b.id = p.bill_id
        JOIN branches br ON br.id = b.branch_id
        WHERE p.status = 'PAID'
          AND p.paid_at >= ${start} AND p.paid_at < ${end}
          AND br.restaurant_id = ${restaurant.id}::uuid
        GROUP BY 1
      `,
    );
    const refunds = await this.prisma.$queryRaw<RefundAggregateRow[]>(
      Prisma.sql`
        SELECT ${refundKey} AS key,
               COALESCE(SUM(r.amount - r.tip_amount), 0) AS refunds
        FROM refunds r
        JOIN payments p ON p.id = r.payment_id
        JOIN branches br ON br.id = r.branch_id
        WHERE r.status = 'SUCCEEDED'
          AND r.completed_at >= ${start} AND r.completed_at < ${end}
          AND br.restaurant_id = ${restaurant.id}::uuid
        GROUP BY 1
      `,
    );
    const groups = new Map<string, GroupedFigures>();
    const entry = (key: string): GroupedFigures =>
      groups.get(key) ?? { key, gross: ZERO, tips: ZERO, refunds: ZERO };

    for (const row of payments) {
      groups.set(row.key, {
        ...entry(row.key),
        gross: toDecimal(row.gross),
        tips: toDecimal(row.tips),
      });
    }

    for (const row of refunds) {
      groups.set(row.key, {
        ...entry(row.key),
        refunds: toDecimal(row.refunds),
      });
    }

    return [...groups.values()].sort((a, b) => a.key.localeCompare(b.key));
  }

  private async upsertStatement(
    restaurant: RestaurantRecord,
    period: string,
    live: LiveStatement,
    status: 'ISSUED' | 'DRAFT',
    breakdown: StoredBreakdown | null,
  ): Promise<number> {
    const { figures } = live;
    const issuedAt = status === 'ISSUED' ? new Date() : null;
    const update =
      status === 'ISSUED'
        ? Prisma.sql`
          DO UPDATE SET
            gross_sales = EXCLUDED.gross_sales,
            tips_total = EXCLUDED.tips_total,
            discounts = EXCLUDED.discounts,
            refunds_total = EXCLUDED.refunds_total,
            carry_over_in = EXCLUDED.carry_over_in,
            net_sales = EXCLUDED.net_sales,
            fee_bps = EXCLUDED.fee_bps,
            fee_amount = EXCLUDED.fee_amount,
            status = 'ISSUED',
            breakdown = EXCLUDED.breakdown,
            issued_at = EXCLUDED.issued_at,
            updated_at = CURRENT_TIMESTAMP
          WHERE platform_fee_statements.status = 'DRAFT'`
        : Prisma.sql`DO NOTHING`;

    return this.prisma.$executeRaw(Prisma.sql`
      INSERT INTO platform_fee_statements (
        id, restaurant_id, period_month, gross_sales, tips_total, discounts,
        refunds_total, carry_over_in, net_sales, fee_bps, fee_amount, status,
        breakdown, issued_at, updated_at
      ) VALUES (
        ${randomUUID()}::uuid, ${restaurant.id}::uuid, ${`${period}-01`}::date,
        ${money(figures.gross)}::numeric, ${money(figures.tips)}::numeric,
        0::numeric, ${money(figures.refunds)}::numeric,
        ${money(figures.carryOver)}::numeric, ${money(figures.net)}::numeric,
        ${restaurant.platformFeeBps}::int, ${figures.fee.toFixed(0)}::numeric,
        ${status}::"PlatformFeeStatementStatus",
        ${breakdown ? JSON.stringify(breakdown) : null}::jsonb,
        ${issuedAt}::timestamptz, CURRENT_TIMESTAMP
      )
      ON CONFLICT (restaurant_id, period_month) ${update}
    `);
  }

  private totals(rows: StatementRow[]): StatementTotals {
    const sum = (pick: (row: StatementRow) => string): string =>
      money(sumDecimals(rows.map((row) => new Prisma.Decimal(pick(row)))));

    return {
      grossSales: sum((r) => r.grossSales),
      tipsTotal: sum((r) => r.tipsTotal),
      refunds: sum((r) => r.refunds),
      discounts: sum((r) => r.discounts),
      carryOver: sum((r) => r.carryOver),
      netSales: sum((r) => r.netSales),
      feeAmount: sum((r) => r.feeAmount),
    };
  }
}

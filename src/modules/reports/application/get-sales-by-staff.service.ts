import { ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { JwtPayload } from '../../auth/interfaces/jwt-payload.interface';
import {
  ReportsInsightsPrismaRepository,
  type StaffBreakdownRecord,
} from '../infrastructure/reports-insights.prisma.repository';
import type { CsvDownload } from './get-sales-by-order.service';
import {
  ZERO,
  money,
  ratio,
  resolveInsightsScope,
  rowsCsv,
  toBillFilter,
  type InsightsQuery,
} from './insights-shared';
import { ReportScopeService } from './report-scope.service';
import {
  CAJA_ONLINE_LABEL,
  CAJA_UNASSIGNED_LABEL,
  type ReportScope,
} from './report-types';

export const STAFF_ROLES = ['waiter', 'cashier'] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

export type SalesByStaffQuery = InsightsQuery & { role?: StaffRole };

export type SalesByStaffRow = {
  staffId: string | null;
  name: string;
  bills: number;
  guests: number;
  amount: string;
  refunded: string;
  net: string;
  averageTicket: string;
  tip: string;
  tipPerBill: string;
};

export type SalesByStaffTotals = Omit<SalesByStaffRow, 'staffId' | 'name'>;

export type SalesByStaffResponse = {
  role: StaffRole;
  from: string;
  to: string;
  timeZone: string;
  cashierId: string | null;
  rows: SalesByStaffRow[];
  totals: SalesByStaffTotals;
};

export const SALES_BY_STAFF_CSV_HEADERS = [
  'Nombre',
  'Cuentas',
  'Comensales',
  'Monto',
  'Reembolsado',
  'Neto',
  'Ticket promedio',
  'Propina',
  'Propina por cuenta',
];

function labelOf(record: StaffBreakdownRecord): string {
  if (record.name) {
    return record.name;
  }

  return record.online ? CAJA_ONLINE_LABEL : CAJA_UNASSIGNED_LABEL;
}

function averages(
  net: Prisma.Decimal,
  tip: Prisma.Decimal,
  bills: number,
): Pick<SalesByStaffRow, 'averageTicket' | 'tipPerBill'> {
  return {
    averageTicket: ratio(net, bills, 0),
    tipPerBill: ratio(tip, bills, 0),
  };
}

export function buildSalesByStaff(
  records: StaffBreakdownRecord[],
): Pick<SalesByStaffResponse, 'rows' | 'totals'> {
  let bills = 0;
  let guests = 0;
  let amount = ZERO;
  let refunded = ZERO;
  let tip = ZERO;

  const rows = records.map((record) => {
    const rowAmount = new Prisma.Decimal(record.amount);
    const rowTip = new Prisma.Decimal(record.tip);
    const rowRefunded = new Prisma.Decimal(record.refunded);
    const rowNet = rowAmount.sub(rowRefunded);

    bills += record.bills;
    guests += record.guests;
    amount = amount.add(rowAmount);
    refunded = refunded.add(rowRefunded);
    tip = tip.add(rowTip);

    return {
      staffId: record.staff_id,
      name: labelOf(record),
      bills: record.bills,
      guests: record.guests,
      amount: money(rowAmount),
      refunded: money(rowRefunded),
      net: money(rowNet),
      tip: money(rowTip),
      ...averages(rowNet, rowTip, record.bills),
    };
  });

  return {
    rows,
    totals: {
      bills,
      guests,
      amount: money(amount),
      refunded: money(refunded),
      net: money(amount.sub(refunded)),
      tip: money(tip),
      ...averages(amount.sub(refunded), tip, bills),
    },
  };
}

@Injectable()
export class GetSalesByStaffService {
  constructor(
    private readonly scopeService: ReportScopeService,
    private readonly insightsRepository: ReportsInsightsPrismaRepository,
  ) {}

  async execute(
    authUser: JwtPayload,
    branchId: string,
    query: SalesByStaffQuery,
  ): Promise<SalesByStaffResponse> {
    const role = query.role ?? 'waiter';
    const { scope, records } = await this.load(
      authUser,
      branchId,
      query,
      role,
      false,
    );

    return {
      role,
      from: scope.from,
      to: scope.to,
      timeZone: scope.timeZone,
      cashierId: scope.cashierId,
      ...buildSalesByStaff(records),
    };
  }

  async executeCsv(
    authUser: JwtPayload,
    branchId: string,
    query: SalesByStaffQuery,
  ): Promise<CsvDownload> {
    const role = query.role ?? 'waiter';
    const { scope, records } = await this.load(
      authUser,
      branchId,
      query,
      role,
      true,
    );
    const { rows, totals } = buildSalesByStaff(records);

    return rowsCsv(
      `ventas-por-${role === 'waiter' ? 'mesero' : 'cajero'}_${branchId}_${scope.from}_${scope.to}.csv`,
      SALES_BY_STAFF_CSV_HEADERS,
      [
        ...rows.map((row) => [
          row.name,
          row.bills,
          row.guests,
          Number(row.amount),
          Number(row.refunded),
          Number(row.net),
          Number(row.averageTicket),
          Number(row.tip),
          Number(row.tipPerBill),
        ]),
        [
          'TOTAL',
          totals.bills,
          totals.guests,
          Number(totals.amount),
          Number(totals.refunded),
          Number(totals.net),
          Number(totals.averageTicket),
          Number(totals.tip),
          Number(totals.tipPerBill),
        ],
      ],
    );
  }

  private async load(
    authUser: JwtPayload,
    branchId: string,
    query: SalesByStaffQuery,
    role: StaffRole,
    forCsv: boolean,
  ): Promise<{ scope: ReportScope; records: StaffBreakdownRecord[] }> {
    const scope = await resolveInsightsScope(
      this.scopeService,
      authUser,
      branchId,
      query,
      forCsv,
    );

    if (scope.cashierScoped && role === 'waiter') {
      throw new ForbiddenException(
        'Tu rol solo puede consultar las ventas por cajero.',
      );
    }

    const filter = toBillFilter(scope);

    return {
      scope,
      records:
        role === 'waiter'
          ? await this.insightsRepository.findWaiterBreakdown(filter)
          : await this.insightsRepository.findCashierBreakdown(filter),
    };
  }
}

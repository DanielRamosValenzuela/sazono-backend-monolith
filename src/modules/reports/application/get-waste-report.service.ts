import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type { JwtPayload } from '../../auth/interfaces/jwt-payload.interface';
import { money } from './insights-shared';
import {
  ReportScopeService,
  type ReportScopeQuery,
} from './report-scope.service';

export type WasteReportQuery = Pick<ReportScopeQuery, 'from' | 'to'>;

type WasteRecord = {
  item_name: string;
  station_name: string;
  quantity: number;
  amount: Prisma.Decimal.Value;
  refunds: number;
};

export type WasteReportRow = {
  itemName: string;
  station: string;
  quantity: number;
  amount: string;
  refunds: number;
};

export type WasteReportResponse = {
  branchId: string;
  from: string;
  to: string;
  timeZone: string;
  totals: { quantity: number; amount: string };
  byStation: { station: string; quantity: number; amount: string }[];
  rows: WasteReportRow[];
};

@Injectable()
export class GetWasteReportService {
  constructor(
    private readonly scopeService: ReportScopeService,
    private readonly prisma: PrismaService,
  ) {}

  async execute(
    authUser: JwtPayload,
    branchId: string,
    query: WasteReportQuery,
  ): Promise<WasteReportResponse> {
    const scope = await this.scopeService.resolve(authUser, branchId, query, {
      forCsv: false,
      fullAccessOnly: true,
    });
    const records = await this.prisma.$queryRaw<WasteRecord[]>(Prisma.sql`
      SELECT
        ri.name_snapshot AS item_name,
        COALESCE(ps.name, '-') AS station_name,
        COALESCE(SUM(ri.quantity), 0)::int AS quantity,
        COALESCE(SUM(ri.amount), 0) AS amount,
        COUNT(DISTINCT ri.refund_id)::int AS refunds
      FROM refund_items ri
      JOIN refunds r ON r.id = ri.refund_id
      LEFT JOIN preparation_stations ps ON ps.id = ri.preparation_station_id
      WHERE r.branch_id = ${branchId}::uuid
        AND r.status = 'SUCCEEDED'
        AND ri.kitchen_waste = TRUE
        AND r.completed_at >= ${scope.start}
        AND r.completed_at < ${scope.end}
      GROUP BY ri.name_snapshot, ps.name
      ORDER BY SUM(ri.amount) DESC, ri.name_snapshot ASC
    `);
    const stations = new Map<
      string,
      { quantity: number; amount: Prisma.Decimal }
    >();
    let quantity = 0;
    let amount = new Prisma.Decimal(0);

    const rows = records.map((record): WasteReportRow => {
      const value = new Prisma.Decimal(record.amount);
      const station = stations.get(record.station_name) ?? {
        quantity: 0,
        amount: new Prisma.Decimal(0),
      };

      stations.set(record.station_name, {
        quantity: station.quantity + record.quantity,
        amount: station.amount.add(value),
      });
      quantity += record.quantity;
      amount = amount.add(value);

      return {
        itemName: record.item_name,
        station: record.station_name,
        quantity: record.quantity,
        amount: money(value),
        refunds: record.refunds,
      };
    });

    return {
      branchId,
      from: scope.from,
      to: scope.to,
      timeZone: scope.timeZone,
      totals: { quantity, amount: money(amount) },
      byStation: [...stations.entries()]
        .map(([station, entry]) => ({
          station,
          quantity: entry.quantity,
          amount: money(entry.amount),
        }))
        .sort((a, b) => Number(b.amount) - Number(a.amount)),
      rows,
    };
  }
}

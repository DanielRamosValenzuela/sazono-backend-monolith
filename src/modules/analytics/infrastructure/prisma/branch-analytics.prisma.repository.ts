import { Injectable } from '@nestjs/common';
import {
  OrderStatus,
  PaymentStatus,
  Prisma,
  TableSessionStatus,
  TableStatus,
} from '@prisma/client';
import { PrismaService } from '../../../../common/prisma/prisma.service';

export type PaidPaymentRecord = {
  amount: Prisma.Decimal;
  paidAt: Date | null;
  createdAt: Date;
};

export type OrdersByStatusRecord = {
  status: OrderStatus;
  count: number;
};

export type TopItemRecord = {
  name: string;
  quantity: number;
  amount: Prisma.Decimal | null;
};

const TOP_ITEMS_LIMIT = 5;

@Injectable()
export class BranchAnalyticsPrismaRepository {
  constructor(private readonly prisma: PrismaService) {}

  countTables(branchId: string): Promise<number> {
    return this.prisma.table.count({
      where: {
        branchId,
      },
    });
  }

  countOccupiedTables(branchId: string): Promise<number> {
    return this.prisma.table.count({
      where: {
        branchId,
        status: TableStatus.OCCUPIED,
      },
    });
  }

  countOpenSessions(branchId: string): Promise<number> {
    return this.prisma.tableSession.count({
      where: {
        branchId,
        status: TableSessionStatus.OPEN,
      },
    });
  }

  findPaidPaymentsInRange(
    branchId: string,
    since: Date,
    until: Date,
  ): Promise<PaidPaymentRecord[]> {
    return this.prisma.payment.findMany({
      where: {
        status: PaymentStatus.PAID,
        bill: {
          branchId,
        },
        OR: [
          {
            paidAt: {
              gte: since,
              lte: until,
            },
          },
          {
            paidAt: null,
            createdAt: {
              gte: since,
              lte: until,
            },
          },
        ],
      },
      select: {
        amount: true,
        paidAt: true,
        createdAt: true,
      },
    });
  }

  async groupOrdersByStatusInRange(
    branchId: string,
    since: Date,
    until: Date,
  ): Promise<OrdersByStatusRecord[]> {
    const groups = await this.prisma.order.groupBy({
      by: ['status'],
      where: {
        branchId,
        createdAt: {
          gte: since,
          lte: until,
        },
      },
      _count: {
        _all: true,
      },
    });

    return groups.map((group) => ({
      status: group.status,
      count: group._count._all,
    }));
  }

  findTopItemsInRange(
    branchId: string,
    since: Date,
    until: Date,
  ): Promise<TopItemRecord[]> {
    return this.prisma.$queryRaw<TopItemRecord[]>`
      SELECT
        oi.name_snapshot AS name,
        SUM(oi.quantity)::int AS quantity,
        SUM(oi.price_snapshot * oi.quantity) AS amount
      FROM order_items oi
      INNER JOIN orders o ON o.id = oi.order_id
      WHERE o.branch_id = ${branchId}::uuid
        AND oi.status <> 'CANCELLED'
        AND oi.created_at >= ${since}
        AND oi.created_at <= ${until}
      GROUP BY oi.name_snapshot
      ORDER BY SUM(oi.price_snapshot * oi.quantity) DESC
      LIMIT ${TOP_ITEMS_LIMIT}
    `;
  }
}

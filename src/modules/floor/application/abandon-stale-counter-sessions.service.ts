import { Injectable } from '@nestjs/common';
import { BillStatus, TableSessionStatus } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import {
  COUNTER_STALE_AUTO_ABANDON_REASON,
  COUNTER_STALE_MAX_AGE_HOURS,
} from '../domain/counter-table';

@Injectable()
export class AbandonStaleCounterSessionsService {
  constructor(private readonly prisma: PrismaService) {}

  async execute(now: Date = new Date()): Promise<number> {
    const cutoff = new Date(
      now.getTime() - COUNTER_STALE_MAX_AGE_HOURS * 3_600_000,
    );

    return this.prisma.$transaction(async (tx) => {
      const stale = await tx.tableSession.findMany({
        where: {
          isCounter: true,
          status: {
            in: [TableSessionStatus.OPEN, TableSessionStatus.PAYMENT_COMPLETED],
          },
          openedAt: { lt: cutoff },
        },
        select: { id: true },
      });

      if (stale.length === 0) {
        return 0;
      }

      const ids = stale.map((session) => session.id);

      const { count } = await tx.tableSession.updateMany({
        where: {
          id: { in: ids },
          status: {
            in: [TableSessionStatus.OPEN, TableSessionStatus.PAYMENT_COMPLETED],
          },
        },
        data: {
          status: TableSessionStatus.ABANDONED,
          closeReason: COUNTER_STALE_AUTO_ABANDON_REASON,
          closedAt: now,
        },
      });
      await tx.bill.updateMany({
        where: {
          tableSessionId: { in: ids },
          status: { in: [BillStatus.OPEN, BillStatus.PARTIALLY_PAID] },
        },
        data: {
          status: BillStatus.ABANDONED,
          closeReason: COUNTER_STALE_AUTO_ABANDON_REASON,
          closedAt: now,
        },
      });

      return count;
    });
  }
}

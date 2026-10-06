import { Injectable } from '@nestjs/common';
import { OrderStatus } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type { JwtPayload } from '../../auth/interfaces/jwt-payload.interface';
import { BranchAccessService } from '../../../common/branch-access/branch-access.service';
import { ACTIVE_TABLE_SESSION_STATUSES } from '../domain/active-table-session-statuses';
import { rollupCounterReadiness } from '../domain/counter-readiness';
import { COUNTER_SESSION_ROLES } from '../domain/counter-table';
import type {
  CounterSessionListItemDto,
  ListCounterSessionsQueryDto,
} from '../presentation/http/dto/floor.dto';

@Injectable()
export class ListCounterSessionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly branchAccessService: BranchAccessService,
  ) {}

  async execute(
    authUser: JwtPayload,
    query: ListCounterSessionsQueryDto,
  ): Promise<CounterSessionListItemDto[]> {
    const context = await this.branchAccessService.ensureAccess(
      authUser,
      query.branchId,
      COUNTER_SESSION_ROLES,
    );

    const sessions = await this.prisma.tableSession.findMany({
      where: {
        branchId: query.branchId,
        isCounter: true,
        status: { in: ACTIVE_TABLE_SESSION_STATUSES },
        ...(query.mine ? { openedByStaffUserId: context.staffUserId } : {}),
      },
      include: {
        bill: true,
        orders: { select: { id: true, status: true, updatedAt: true } },
      },
      orderBy: { openedAt: 'asc' },
    });

    return sessions
      .filter((session) => session.bill !== null)
      .map((session) => {
        const bill = session.bill!;
        const readiness = rollupCounterReadiness(
          session.orders.map((order) => order.status),
        );
        const readyAt =
          readiness === 'READY'
            ? session.orders
                .filter((order) => order.status === OrderStatus.READY)
                .reduce<Date | null>(
                  (latest, order) =>
                    !latest || order.updatedAt > latest
                      ? order.updatedAt
                      : latest,
                  null,
                )
            : null;

        return {
          tableSessionId: session.id,
          billId: bill.id,
          ticketNumber: session.ticketNumber!,
          customerLabel: session.customerLabel,
          status: session.status,
          openedByStaffUserId: session.openedByStaffUserId,
          openedAt: session.openedAt.toISOString(),
          bill: {
            status: bill.status,
            total: bill.totalAmount.toString(),
            paid: bill.totalAmount.minus(bill.remainingAmount).toString(),
            remaining: bill.remainingAmount.toString(),
          },
          orders: session.orders.map((order) => ({
            orderId: order.id,
            status: order.status,
          })),
          readiness,
          ...(readyAt ? { readyAt: readyAt.toISOString() } : {}),
        };
      });
  }
}

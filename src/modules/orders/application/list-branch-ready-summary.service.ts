import { Injectable } from '@nestjs/common';
import { OrderItemStatus, OrderStatus, Role } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type { JwtPayload } from '../../auth/interfaces/jwt-payload.interface';
import { BranchAccessService } from '../../../common/branch-access/branch-access.service';
import { ACTIVE_TABLE_SESSION_STATUSES } from '../../floor/domain/active-table-session-statuses';
import type {
  BranchReadySummaryItemDto,
  ListBranchReadySummaryQueryDto,
} from '../presentation/http/dto/orders.dto';

@Injectable()
export class ListBranchReadySummaryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly branchAccessService: BranchAccessService,
  ) {}

  async execute(
    authUser: JwtPayload,
    query: ListBranchReadySummaryQueryDto,
  ): Promise<BranchReadySummaryItemDto[]> {
    await this.branchAccessService.ensureAccess(authUser, query.branchId, [
      Role.ADMIN,
      Role.SUPERVISOR,
      Role.WAITER,
      Role.CASHIER,
      Role.KITCHEN,
      Role.BAR,
    ]);

    const branchSettings = await this.prisma.branchSettings.findUnique({
      where: { branchId: query.branchId },
      select: { autoDeliverAfterMinutes: true },
    });
    const autoDeliverAfterMinutes =
      branchSettings?.autoDeliverAfterMinutes ?? null;

    const readyOrders = await this.prisma.order.findMany({
      where: {
        branchId: query.branchId,
        status: OrderStatus.READY,
        tableSession: {
          status: { in: ACTIVE_TABLE_SESSION_STATUSES },
        },
      },
      select: {
        id: true,
        tableSessionId: true,
        tableSession: {
          select: {
            tableId: true,
            openedByStaffUserId: true,
            table: {
              select: { code: true },
            },
          },
        },
        stationTickets: {
          select: { completedAt: true },
        },
      },
    });

    const orderIdsToAutoDeliver: string[] = [];
    const stillReadyOrders: typeof readyOrders = [];
    const now = Date.now();

    for (const order of readyOrders) {
      const readyAt = order.stationTickets.reduce<Date | null>(
        (latest, ticket) => {
          if (!ticket.completedAt) {
            return latest;
          }
          return !latest || ticket.completedAt > latest
            ? ticket.completedAt
            : latest;
        },
        null,
      );

      const minutesReady = readyAt ? (now - readyAt.getTime()) / 60_000 : 0;

      if (
        autoDeliverAfterMinutes !== null &&
        readyAt &&
        minutesReady >= autoDeliverAfterMinutes
      ) {
        orderIdsToAutoDeliver.push(order.id);
      } else {
        stillReadyOrders.push(order);
      }
    }

    if (orderIdsToAutoDeliver.length > 0) {
      await this.prisma.$transaction([
        this.prisma.order.updateMany({
          where: { id: { in: orderIdsToAutoDeliver } },
          data: { status: OrderStatus.DELIVERED },
        }),
        this.prisma.orderItem.updateMany({
          where: {
            orderId: { in: orderIdsToAutoDeliver },
            status: { not: OrderItemStatus.CANCELLED },
          },
          data: { status: OrderItemStatus.DELIVERED },
        }),
      ]);
    }

    const bySession = new Map<string, BranchReadySummaryItemDto>();

    for (const order of stillReadyOrders) {
      const existing = bySession.get(order.tableSessionId);

      if (existing) {
        existing.readyUndeliveredCount += 1;
        continue;
      }

      bySession.set(order.tableSessionId, {
        tableSessionId: order.tableSessionId,
        tableId: order.tableSession.tableId,
        tableCode: order.tableSession.table.code,
        openedByStaffUserId: order.tableSession.openedByStaffUserId,
        readyUndeliveredCount: 1,
      });
    }

    return [...bySession.values()];
  }
}

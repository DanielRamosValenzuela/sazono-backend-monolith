import { Injectable } from '@nestjs/common';
import { OrderItemStatus, OrderStatus, Role } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type { JwtPayload } from '../../auth/interfaces/jwt-payload.interface';
import { BranchAccessService } from '../../../common/branch-access/branch-access.service';
import { ACTIVE_TABLE_SESSION_STATUSES } from '../../floor/domain/active-table-session-statuses';
import { COUNTER_TABLE_CODE } from '../../floor/domain/counter-table';
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
      select: { autoDeliverAfterMinutes: true, tableAssignmentEnabled: true },
    });
    const autoDeliverAfterMinutes =
      branchSettings?.autoDeliverAfterMinutes ?? null;
    const isTableAssignmentEnabled =
      branchSettings?.tableAssignmentEnabled ?? false;

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
            assignedStaffUserId: true,
            isCounter: true,
            ticketNumber: true,
            customerLabel: true,
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
        !order.tableSession.isCounter &&
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
      await this.prisma.$transaction(async (tx) => {
        const claimed = await tx.order.findMany({
          where: {
            id: { in: orderIdsToAutoDeliver },
            status: OrderStatus.READY,
          },
          select: { id: true },
        });
        const claimedIds = claimed.map((order) => order.id);

        await tx.order.updateMany({
          where: { id: { in: claimedIds }, status: OrderStatus.READY },
          data: { status: OrderStatus.DELIVERED },
        });
        await tx.orderItem.updateMany({
          where: {
            orderId: { in: claimedIds },
            status: { not: OrderItemStatus.CANCELLED },
          },
          data: { status: OrderItemStatus.DELIVERED },
        });
      });
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
        tableCode: order.tableSession.isCounter
          ? COUNTER_TABLE_CODE
          : order.tableSession.table.code,
        isCounter: order.tableSession.isCounter,
        ticketNumber: order.tableSession.ticketNumber,
        customerLabel: order.tableSession.customerLabel,
        openedByStaffUserId: order.tableSession.openedByStaffUserId,
        assignedStaffUserId: isTableAssignmentEnabled
          ? order.tableSession.assignedStaffUserId
          : null,
        readyUndeliveredCount: 1,
      });
    }

    return [...bySession.values()];
  }
}

import { BadRequestException, Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  BillStatus,
  OrderSource,
  OrderStatus,
  PaymentPolicy,
  Role,
} from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type { JwtPayload } from '../../auth/interfaces/jwt-payload.interface';
import { ACTIVE_TABLE_SESSION_STATUSES } from '../../floor/domain/active-table-session-statuses';
import { applyOrderChargeToBill } from './apply-order-charge-to-bill';
import { ORDER_CREATED_EVENT } from '../domain/order-events';
import type { OrderCreatedEvent } from '../domain/order-events';
import { ORDER_INCLUDE, mapOrder } from './order-mapper';
import { OrderableMenuItemResolverService } from './orderable-menu-item-resolver.service';
import { BranchAccessService } from '../../../common/branch-access/branch-access.service';
import { routeOrderToStations } from './route-order-to-stations';
import type {
  CreateWaiterOrderDto,
  OrderResponseDto,
} from '../presentation/http/dto/orders.dto';

@Injectable()
export class CreateWaiterOrderService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly branchAccessService: BranchAccessService,
    private readonly orderableMenuItemResolverService: OrderableMenuItemResolverService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async execute(
    authUser: JwtPayload,
    dto: CreateWaiterOrderDto,
  ): Promise<OrderResponseDto> {
    const tableSession = await this.prisma.tableSession.findUnique({
      where: {
        id: dto.tableSessionId,
      },
      include: {
        bill: true,
      },
    });

    if (!tableSession) {
      throw new BadRequestException('La sesion indicada no existe.');
    }

    if (!ACTIVE_TABLE_SESSION_STATUSES.includes(tableSession.status)) {
      throw new BadRequestException(
        'La sesion indicada no esta activa y no puede recibir ordenes.',
      );
    }

    const context = await this.branchAccessService.ensureAccess(
      authUser,
      tableSession.branchId,
      [Role.ADMIN, Role.SUPERVISOR, Role.WAITER, Role.CASHIER, Role.KITCHEN],
    );

    const resolvedItems = await this.orderableMenuItemResolverService.resolve(
      tableSession.branchId,
      dto.items,
    );

    const orderId = await this.prisma.$transaction(async (tx) => {
      const bill =
        tableSession.bill ??
        (await tx.bill.create({
          data: {
            tableSessionId: tableSession.id,
            branchId: tableSession.branchId,
            status: BillStatus.OPEN,
          },
        }));

      const order = await tx.order.create({
        data: {
          tableSessionId: tableSession.id,
          billId: bill.id,
          branchId: tableSession.branchId,
          source: OrderSource.WAITER,
          paymentPolicy: PaymentPolicy.POSTPAID,
          status: OrderStatus.ROUTED,
          createdByStaffUserId: context.staffUserId,
          submittedAt: new Date(),
          notes: dto.notes?.trim() || null,
        },
      });

      const orderItemsWithIds: Array<
        (typeof resolvedItems)[number] & { orderItemId: string }
      > = [];

      for (const item of resolvedItems) {
        const orderItem = await tx.orderItem.create({
          data: {
            orderId: order.id,
            menuItemId: item.menuItemId,
            preparationStationId: item.preparationStationId,
            nameSnapshot: item.name,
            priceSnapshot: item.price,
            quantity: item.quantity,
            notes: item.notes,
            modifiers: {
              create: item.modifiers.map((modifier) => ({
                modifierOptionId: modifier.modifierOptionId,
                nameSnapshot: modifier.name,
                priceDeltaSnapshot: modifier.priceDelta,
              })),
            },
          },
        });

        orderItemsWithIds.push({ ...item, orderItemId: orderItem.id });
      }

      await applyOrderChargeToBill(tx, bill, orderItemsWithIds);
      await routeOrderToStations(tx, order, orderItemsWithIds);

      return order.id;
    });

    const event: OrderCreatedEvent = {
      orderId,
      branchId: tableSession.branchId,
    };

    this.eventEmitter.emit(ORDER_CREATED_EVENT, event);

    const order = await this.prisma.order.findUniqueOrThrow({
      where: {
        id: orderId,
      },
      include: ORDER_INCLUDE,
    });

    return mapOrder(order);
  }
}

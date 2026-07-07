import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  BillStatus,
  OrderSource,
  OrderStatus,
  PaymentPolicy,
  TableSessionOpenedBySource,
  TableStatus,
} from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { ACTIVE_TABLE_SESSION_STATUSES } from '../../floor/domain/active-table-session-statuses';
import { ORDER_INCLUDE, mapOrder } from './order-mapper';
import { OrderableMenuItemResolverService } from './orderable-menu-item-resolver.service';
import type {
  CreateQrOrderDto,
  OrderResponseDto,
} from '../presentation/http/dto/orders.dto';

@Injectable()
export class CreateQrOrderService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orderableMenuItemResolverService: OrderableMenuItemResolverService,
  ) {}

  /**
   * Crea una orden prepago iniciada por el cliente final via QR.
   *
   * La orden queda en AWAITING_PAYMENT: no genera cargos en la cuenta ni
   * tickets de estacion hasta que el pago sea aprobado por el modulo de
   * payments. Si la mesa no tiene sesion activa, este pedido la abre.
   */
  async execute(
    qrToken: string,
    dto: CreateQrOrderDto,
  ): Promise<OrderResponseDto> {
    const table = await this.prisma.table.findUnique({
      where: {
        qrToken,
      },
      include: {
        branch: {
          include: {
            settings: true,
          },
        },
      },
    });

    if (!table || table.status === TableStatus.DISABLED) {
      throw new NotFoundException('El QR indicado no esta disponible.');
    }

    if (!table.branch.settings?.qrOrderingEnabled) {
      throw new BadRequestException(
        'La sucursal no tiene habilitados los pedidos por QR.',
      );
    }

    const resolvedItems = await this.orderableMenuItemResolverService.resolve(
      table.branchId,
      dto.items,
    );

    const orderId = await this.prisma.$transaction(async (tx) => {
      const existingSession = await tx.tableSession.findFirst({
        where: {
          tableId: table.id,
          status: {
            in: ACTIVE_TABLE_SESSION_STATUSES,
          },
        },
        include: {
          bill: true,
        },
      });

      let tableSessionId: string;
      let billId: string;

      if (existingSession) {
        tableSessionId = existingSession.id;
        billId =
          existingSession.bill?.id ??
          (
            await tx.bill.create({
              data: {
                tableSessionId: existingSession.id,
                branchId: table.branchId,
                status: BillStatus.OPEN,
              },
            })
          ).id;
      } else {
        const createdSession = await tx.tableSession.create({
          data: {
            tableId: table.id,
            branchId: table.branchId,
            openedBySource: TableSessionOpenedBySource.QR,
          },
        });

        const createdBill = await tx.bill.create({
          data: {
            tableSessionId: createdSession.id,
            branchId: table.branchId,
            status: BillStatus.OPEN,
          },
        });

        await tx.table.update({
          where: {
            id: table.id,
          },
          data: {
            status: TableStatus.OCCUPIED,
          },
        });

        tableSessionId = createdSession.id;
        billId = createdBill.id;
      }

      const order = await tx.order.create({
        data: {
          tableSessionId,
          billId,
          branchId: table.branchId,
          source: OrderSource.QR,
          paymentPolicy: PaymentPolicy.PREPAID,
          status: OrderStatus.AWAITING_PAYMENT,
          submittedAt: new Date(),
          notes: dto.notes?.trim() || null,
        },
      });

      await tx.orderItem.createMany({
        data: resolvedItems.map((item) => ({
          orderId: order.id,
          menuItemId: item.menuItemId,
          preparationStationId: item.preparationStationId,
          nameSnapshot: item.name,
          priceSnapshot: item.price,
          quantity: item.quantity,
          notes: item.notes,
        })),
      });

      return order.id;
    });

    const order = await this.prisma.order.findUniqueOrThrow({
      where: {
        id: orderId,
      },
      include: ORDER_INCLUDE,
    });

    return mapOrder(order);
  }
}

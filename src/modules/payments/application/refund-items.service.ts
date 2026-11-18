import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, RefundStatus, Role } from '@prisma/client';
import { BranchAccessService } from '../../../common/branch-access/branch-access.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type { JwtPayload } from '../../auth/interfaces/jwt-payload.interface';
import type {
  BillRefundableItemDto,
  CreateRefundItemsDto,
  PreviewRefundItemsDto,
  RefundItemsPreviewResponseDto,
  RefundResultResponseDto,
} from '../presentation/http/dto/refunds.dto';
import { mapPaymentRefundState } from './refund-mapper';
import {
  RefundPaymentService,
  type RefundRequestMeta,
} from './refund-payment.service';

@Injectable()
export class RefundItemsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly branchAccessService: BranchAccessService,
    private readonly refundPaymentService: RefundPaymentService,
  ) {}

  async list(
    authUser: JwtPayload,
    branchId: string,
    billId: string,
  ): Promise<{ billId: string; items: BillRefundableItemDto[] }> {
    await this.branchAccessService.ensureAccess(authUser, branchId, [
      Role.ADMIN,
      Role.CASHIER,
    ]);

    const bill = await this.prisma.bill.findFirst({
      where: { id: billId, branchId },
      select: { id: true },
    });

    if (!bill) {
      throw new NotFoundException({
        message: 'La cuenta indicada no existe en esta sucursal.',
        code: 'BILL_NOT_FOUND',
      });
    }

    const lines = await this.prisma.billItem.findMany({
      where: { billId, status: 'OPEN' },
      orderBy: { createdAt: 'asc' },
      include: {
        orderItem: { select: { nameSnapshot: true } },
        refundItems: {
          where: { refund: { status: { not: RefundStatus.FAILED } } },
          select: { amount: true },
        },
      },
    });

    return {
      billId,
      items: lines.map((line) => {
        const net = line.totalPrice.sub(line.discountAmount);
        const refundedAmount = line.refundItems.reduce(
          (sum, item) => sum.add(item.amount),
          new Prisma.Decimal(0),
        );
        const availableQuantity = line.quantity - line.refundedQuantity;

        return {
          billItemId: line.id,
          name: line.orderItem?.nameSnapshot ?? line.description,
          quantity: line.quantity,
          refundedQuantity: line.refundedQuantity,
          availableQuantity,
          unitRefundAmount: net
            .div(line.quantity)
            .toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP)
            .toString(),
          netAmount: net.toString(),
          refundedAmount: refundedAmount.toString(),
        };
      }),
    };
  }

  async preview(
    authUser: JwtPayload,
    branchId: string,
    billId: string,
    dto: PreviewRefundItemsDto,
  ): Promise<RefundItemsPreviewResponseDto> {
    await this.branchAccessService.ensureAccess(authUser, branchId, [
      Role.ADMIN,
      Role.CASHIER,
    ]);

    const payment = await this.prisma.payment.findFirst({
      where: { id: dto.paymentId, billId, bill: { branchId } },
    });

    if (!payment) {
      throw new NotFoundException({
        message: 'El pago indicado no existe en esta cuenta.',
        code: 'PAYMENT_NOT_FOUND',
      });
    }

    const planned = await this.refundPaymentService.planItems(
      payment,
      { billId, items: dto.items },
      dto.refundTip ?? false,
    );

    return {
      paymentId: payment.id,
      lines: planned.lines.map((line) => ({
        billItemId: line.billItemId,
        name: line.name,
        quantity: line.quantity,
        amount: line.amount.toString(),
        availableQuantity: line.availableQuantity,
      })),
      consumptionAmount: planned.consumptionAmount.toString(),
      tipAmount: planned.tipAmount.toString(),
      total: planned.amount.toString(),
      payment: mapPaymentRefundState(payment),
    };
  }

  execute(
    authUser: JwtPayload,
    branchId: string,
    billId: string,
    idempotencyKey: string,
    dto: CreateRefundItemsDto,
    requestMeta: RefundRequestMeta,
  ): Promise<RefundResultResponseDto> {
    const { paymentId, items, ...rest } = dto;

    return this.refundPaymentService.execute(
      authUser,
      branchId,
      paymentId,
      idempotencyKey,
      { ...rest, amount: '0' },
      requestMeta,
      { billId, items },
    );
  }
}

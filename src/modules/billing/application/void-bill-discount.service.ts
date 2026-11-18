import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { BillItemStatus, Role } from '@prisma/client';
import type { ApprovalRequestMeta } from '../../../common/approval/approval-pin.service';
import { AuditService } from '../../../common/audit/audit.service';
import { BranchAccessService } from '../../../common/branch-access/branch-access.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type { JwtPayload } from '../../auth/interfaces/jwt-payload.interface';
import type {
  BillDiscountListDto,
  VoidBillDiscountDto,
  VoidBillDiscountResultDto,
} from '../presentation/http/dto/discounts.dto';
import {
  DISCOUNT_INCLUDE,
  assertBillAcceptsDiscountChanges,
  assertNoPaymentInProgress,
  cancelSplit,
  loadDiscountBill,
  mapBillTotals,
  mapDiscount,
  resolveActiveSplit,
  writeBillTotals,
} from './bill-discount-support';
import { lockBill } from './lock-bill';
import { refreshBillDiscounts } from './refresh-bill-discounts';

@Injectable()
export class VoidBillDiscountService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly branchAccessService: BranchAccessService,
    private readonly auditService: AuditService,
  ) {}

  async execute(
    authUser: JwtPayload,
    branchId: string,
    billId: string,
    discountId: string,
    dto: VoidBillDiscountDto,
    requestMeta: ApprovalRequestMeta,
  ): Promise<VoidBillDiscountResultDto> {
    const context = await this.branchAccessService.ensureAccess(
      authUser,
      branchId,
      [Role.ADMIN, Role.SUPERVISOR, Role.CASHIER],
      { fresh: true },
    );
    const privileged =
      context.roles.includes(Role.ADMIN) ||
      context.roles.includes(Role.SUPERVISOR);
    const actorRole = context.roles.includes(Role.ADMIN)
      ? Role.ADMIN
      : context.roles.includes(Role.SUPERVISOR)
        ? Role.SUPERVISOR
        : Role.CASHIER;
    const reasonText = dto.reasonText.trim();

    return this.prisma.$transaction(async (tx) => {
      await lockBill(tx, billId);

      const discount = await tx.billDiscount.findFirst({
        where: { id: discountId, billId, branchId },
      });

      if (!discount) {
        throw new NotFoundException({
          message: 'El descuento indicado no existe en esta cuenta.',
          code: 'DISCOUNT_NOT_FOUND',
        });
      }

      if (discount.voidedAt) {
        throw new ConflictException({
          message: 'El descuento ya estaba anulado.',
          code: 'DISCOUNT_ALREADY_VOIDED',
        });
      }

      if (
        !privileged &&
        (discount.appliedByStaffUserId !== context.staffUserId ||
          discount.approvedByStaffUserId !== null)
      ) {
        await this.auditService.record(tx, {
          restaurantId: context.restaurantId,
          branchId,
          actorStaffUserId: context.staffUserId,
          actorRole,
          action: 'DISCOUNT_DENIED',
          entityType: 'BillDiscount',
          entityId: discount.id,
          after: { code: 'DISCOUNT_VOID_FORBIDDEN' },
          reason: reasonText,
          ip: requestMeta.ip,
          userAgent: requestMeta.userAgent,
        });

        throw new ForbiddenException({
          message:
            'Solo puedes anular tus propios descuentos sin aprobacion. Pide a un supervisor.',
          code: 'DISCOUNT_VOID_FORBIDDEN',
        });
      }

      const bill = await loadDiscountBill(tx, branchId, billId);

      assertBillAcceptsDiscountChanges(bill);
      await assertNoPaymentInProgress(tx, billId);

      const split = await resolveActiveSplit(tx, billId);

      await tx.billDiscount.update({
        where: { id: discount.id },
        data: {
          voidedAt: new Date(),
          voidedByStaffUserId: context.staffUserId,
          voidReason: reasonText,
        },
      });

      const totalDiscount = await refreshBillDiscounts(tx, billId, {
        resetWhenEmpty: true,
      });
      const updated = await writeBillTotals(tx, bill, totalDiscount);

      if (split) {
        await cancelSplit(tx, split.id);
        await this.auditService.record(tx, {
          restaurantId: context.restaurantId,
          branchId,
          actorStaffUserId: context.staffUserId,
          actorRole,
          action: 'DISCOUNT_SPLIT_CANCELLED',
          entityType: 'BillSplit',
          entityId: split.id,
          after: { billId, discountId: discount.id },
          reason: reasonText,
          ip: requestMeta.ip,
          userAgent: requestMeta.userAgent,
        });
      }

      await this.auditService.record(tx, {
        restaurantId: context.restaurantId,
        branchId,
        actorStaffUserId: context.staffUserId,
        actorRole,
        action: 'DISCOUNT_VOIDED',
        entityType: 'BillDiscount',
        entityId: discount.id,
        before: {
          amount: discount.amount.toString(),
          discount: bill.discountAmount.toString(),
          total: bill.totalAmount.toString(),
          remaining: bill.remainingAmount.toString(),
        },
        after: {
          billId,
          discount: updated.discountAmount.toString(),
          total: updated.totalAmount.toString(),
          remaining: updated.remainingAmount.toString(),
          status: updated.status,
        },
        reason: reasonText,
        ip: requestMeta.ip,
        userAgent: requestMeta.userAgent,
      });

      const full = await tx.billDiscount.findUniqueOrThrow({
        where: { id: discount.id },
        include: DISCOUNT_INCLUDE,
      });

      return {
        discount: mapDiscount(full),
        bill: mapBillTotals(updated),
        splitCancelled: split !== null,
      };
    });
  }
}

@Injectable()
export class ListBillDiscountsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly branchAccessService: BranchAccessService,
  ) {}

  async execute(
    authUser: JwtPayload,
    branchId: string,
    billId: string,
  ): Promise<BillDiscountListDto> {
    await this.branchAccessService.ensureAccess(authUser, branchId, [
      Role.ADMIN,
      Role.SUPERVISOR,
      Role.CASHIER,
    ]);

    const bill = await loadDiscountBill(this.prisma, branchId, billId);
    const [items, discounts, settings] = await Promise.all([
      this.prisma.billItem.findMany({
        where: { billId, status: BillItemStatus.OPEN },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      }),
      this.prisma.billDiscount.findMany({
        where: { billId, branchId },
        include: DISCOUNT_INCLUDE,
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.branchSettings.findUnique({ where: { branchId } }),
    ]);

    return {
      bill: mapBillTotals(bill),
      items: items.map((item) => ({
        billItemId: item.id,
        description: item.description,
        quantity: item.quantity,
        totalPrice: item.totalPrice.toString(),
        discountAmount: item.discountAmount.toString(),
      })),
      discounts: discounts.map(mapDiscount),
      needsApprovalAbovePercent: settings
        ? (settings.discountApprovalPercent?.toString() ?? null)
        : '10',
      needsApprovalAboveAmount:
        settings?.discountApprovalAmount?.toString() ?? null,
    };
  }
}

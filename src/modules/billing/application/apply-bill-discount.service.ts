import { createHash } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { BillItemStatus, DiscountType, Prisma, Role } from '@prisma/client';
import {
  ApprovalPinService,
  type ApprovalRequestMeta,
} from '../../../common/approval/approval-pin.service';
import { AuditService } from '../../../common/audit/audit.service';
import { BranchAccessService } from '../../../common/branch-access/branch-access.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type { JwtPayload } from '../../auth/interfaces/jwt-payload.interface';
import {
  computeDiscounts,
  maxDiscount,
  requiresApproval,
} from '../domain/discount-policy';
import type {
  BillDiscountResultDto,
  CreateBillDiscountDto,
  DiscountPreviewDto,
} from '../presentation/http/dto/discounts.dto';
import {
  DISCOUNT_INCLUDE,
  assertBillAcceptsDiscountChanges,
  assertNoPaymentInProgress,
  cancelSplit,
  loadDiscountBill,
  mapBillTotals,
  mapDiscount,
  paidAmountOf,
  resolveActiveSplit,
  writeBillTotals,
  type DiscountBillRecord,
} from './bill-discount-support';
import { lockBill } from './lock-bill';
import { refreshBillDiscounts } from './refresh-bill-discounts';

const ZERO = new Prisma.Decimal(0);

type Evaluation = {
  bill: DiscountBillRecord;
  newAmount: Prisma.Decimal;
  totalDiscount: Prisma.Decimal;
  max: Prisma.Decimal;
  needsApproval: boolean;
};

@Injectable()
export class ApplyBillDiscountService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly branchAccessService: BranchAccessService,
    private readonly approvalPinService: ApprovalPinService,
    private readonly auditService: AuditService,
  ) {}

  async preview(
    authUser: JwtPayload,
    branchId: string,
    billId: string,
    dto: CreateBillDiscountDto,
  ): Promise<DiscountPreviewDto> {
    const context = await this.access(authUser, branchId);
    const value = this.parseValue(dto);
    const evaluation = await this.evaluate(
      this.prisma,
      branchId,
      billId,
      dto,
      value,
      context.isAdmin,
      false,
    );
    const approvers = evaluation.needsApproval
      ? await this.approvalPinService.listApprovers(
          branchId,
          context.restaurantId,
        )
      : [];
    const after = evaluation.bill;
    const total = after.subtotalAmount
      .sub(evaluation.totalDiscount)
      .add(after.tipAmount);

    return {
      bill: {
        ...mapBillTotals({
          ...after,
          discountAmount: evaluation.totalDiscount,
          totalAmount: total,
          remainingAmount: total.sub(paidAmountOf(after)),
        }),
      },
      newDiscountAmount: evaluation.newAmount.toString(),
      needsApproval: evaluation.needsApproval,
      maxDiscount: evaluation.max.toString(),
      approvers,
    };
  }

  async execute(
    authUser: JwtPayload,
    branchId: string,
    billId: string,
    idempotencyKey: string,
    dto: CreateBillDiscountDto,
    requestMeta: ApprovalRequestMeta,
  ): Promise<BillDiscountResultDto> {
    const context = await this.access(authUser, branchId);
    const value = this.parseValue(dto);
    const reasonText = dto.reasonText.trim();
    const fingerprint = createHash('sha256')
      .update(
        [
          dto.billItemId ?? '',
          dto.type,
          value.toFixed(2),
          dto.reasonCode,
          reasonText,
        ].join('|'),
      )
      .digest('hex');
    const existing = await this.findByKey(billId, idempotencyKey);

    if (existing) {
      return this.replay(existing, context.staffUserId, fingerprint);
    }

    const pre = await this.evaluate(
      this.prisma,
      branchId,
      billId,
      dto,
      value,
      context.isAdmin,
      true,
    );
    let approverStaffUserId: string | null = null;

    if (pre.needsApproval) {
      if (!dto.approverStaffUserId || !dto.approverPin) {
        throw await this.needsApproval(context, branchId, billId, pre, dto);
      }

      approverStaffUserId = await this.approvalPinService.verify(
        context,
        branchId,
        dto.approverStaffUserId,
        dto.approverPin,
        requestMeta,
        {
          failureAction: 'DISCOUNT_APPROVAL_FAILED',
          codePrefix: 'DISCOUNT',
          entityContext: { billId },
          blockedMessage:
            'Demasiados intentos de aprobacion fallidos. Pide a un administrador que aplique el descuento.',
        },
      );
    }

    const actorRole = context.isAdmin
      ? Role.ADMIN
      : context.roles.includes(Role.SUPERVISOR)
        ? Role.SUPERVISOR
        : Role.CASHIER;

    try {
      return await this.prisma.$transaction(async (tx) => {
        await lockBill(tx, billId);

        const evaluation = await this.evaluate(
          tx,
          branchId,
          billId,
          dto,
          value,
          context.isAdmin,
          true,
        );

        if (evaluation.needsApproval && !approverStaffUserId) {
          throw await this.needsApproval(
            context,
            branchId,
            billId,
            evaluation,
            dto,
          );
        }

        const bill = evaluation.bill;
        const split = await resolveActiveSplit(tx, billId);
        const created = await tx.billDiscount.create({
          data: {
            restaurantId: context.restaurantId,
            branchId,
            billId,
            billItemId: dto.billItemId ?? null,
            type: dto.type,
            value,
            amount: evaluation.newAmount,
            reasonCode: dto.reasonCode,
            reasonText,
            idempotencyKey,
            requestFingerprint: fingerprint,
            appliedByStaffUserId: context.staffUserId,
            appliedByRole: actorRole,
            approvedByStaffUserId: evaluation.needsApproval
              ? approverStaffUserId
              : null,
          },
        });
        const totalDiscount = await refreshBillDiscounts(tx, billId);
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
            after: { billId, discountId: created.id },
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
          action: 'DISCOUNT_APPLIED',
          entityType: 'BillDiscount',
          entityId: created.id,
          before: {
            subtotal: bill.subtotalAmount.toString(),
            discount: bill.discountAmount.toString(),
            total: bill.totalAmount.toString(),
            remaining: bill.remainingAmount.toString(),
          },
          after: {
            billId,
            billItemId: dto.billItemId ?? null,
            type: dto.type,
            value: value.toString(),
            amount: evaluation.newAmount.toString(),
            reasonCode: dto.reasonCode,
            idempotencyKey,
            discount: updated.discountAmount.toString(),
            total: updated.totalAmount.toString(),
            remaining: updated.remainingAmount.toString(),
            status: updated.status,
          },
          reason: reasonText,
          ip: requestMeta.ip,
          userAgent: requestMeta.userAgent,
        });

        if (evaluation.needsApproval && approverStaffUserId) {
          await this.auditService.record(tx, {
            restaurantId: context.restaurantId,
            branchId,
            actorStaffUserId: approverStaffUserId,
            actorRole: Role.ADMIN,
            action: 'DISCOUNT_APPROVED',
            entityType: 'BillDiscount',
            entityId: created.id,
            after: {
              approverStaffUserId,
              requiredPercent: evaluation.totalDiscount
                .mul(100)
                .div(bill.subtotalAmount.gt(0) ? bill.subtotalAmount : 1)
                .toDecimalPlaces(2)
                .toString(),
              requestedBy: context.staffUserId,
            },
            reason: reasonText,
            ip: requestMeta.ip,
            userAgent: requestMeta.userAgent,
          });
        }

        const full = await tx.billDiscount.findUniqueOrThrow({
          where: { id: created.id },
          include: DISCOUNT_INCLUDE,
        });

        return {
          discount: mapDiscount(full),
          bill: mapBillTotals(updated),
          splitCancelled: split !== null,
          idempotentReplay: false,
        };
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const raced = await this.findByKey(billId, idempotencyKey);

        if (raced) {
          return this.replay(raced, context.staffUserId, fingerprint);
        }

        throw new ConflictException({
          message: 'Ya existe un descuento activo para esta cuenta o linea.',
          code: 'DISCOUNT_ALREADY_ACTIVE',
        });
      }

      throw error;
    }
  }

  private async access(authUser: JwtPayload, branchId: string) {
    const context = await this.branchAccessService.ensureAccess(
      authUser,
      branchId,
      [Role.ADMIN, Role.SUPERVISOR, Role.CASHIER],
      { fresh: true },
    );

    return { ...context, isAdmin: context.roles.includes(Role.ADMIN) };
  }

  private parseValue(dto: CreateBillDiscountDto): Prisma.Decimal {
    const value = new Prisma.Decimal(dto.value);

    if (value.lte(0)) {
      throw new BadRequestException({
        message: 'El descuento debe ser mayor a cero.',
        code: 'DISCOUNT_VALUE_INVALID',
      });
    }

    if (dto.type === DiscountType.PERCENT && value.gt(100)) {
      throw new BadRequestException({
        message: 'El porcentaje no puede superar 100.',
        code: 'DISCOUNT_VALUE_INVALID',
      });
    }

    if (dto.type === DiscountType.AMOUNT && !value.isInteger()) {
      throw new BadRequestException({
        message: 'El monto debe ser un numero entero de pesos.',
        code: 'DISCOUNT_VALUE_INVALID',
      });
    }

    return value;
  }

  private async evaluate(
    client: Prisma.TransactionClient,
    branchId: string,
    billId: string,
    dto: CreateBillDiscountDto,
    value: Prisma.Decimal,
    isAdmin: boolean,
    checkInProgress: boolean,
  ): Promise<Evaluation> {
    const bill = await loadDiscountBill(client, branchId, billId);

    assertBillAcceptsDiscountChanges(bill);

    if (checkInProgress) {
      await assertNoPaymentInProgress(client, billId);
    }

    const [items, active, settings] = await Promise.all([
      client.billItem.findMany({
        where: { billId, status: BillItemStatus.OPEN },
        select: { id: true, totalPrice: true },
      }),
      client.billDiscount.findMany({ where: { billId, voidedAt: null } }),
      client.branchSettings.findUnique({ where: { branchId } }),
    ]);

    const targetItem = dto.billItemId
      ? items.find((item) => item.id === dto.billItemId)
      : undefined;

    if (dto.billItemId && !targetItem) {
      throw new NotFoundException({
        message: 'La linea indicada no existe o esta anulada.',
        code: 'DISCOUNT_ITEM_NOT_FOUND',
      });
    }

    if (
      targetItem &&
      dto.type === DiscountType.AMOUNT &&
      value.gt(targetItem.totalPrice)
    ) {
      throw new BadRequestException({
        message: 'El descuento no puede superar el total de la linea.',
        code: 'DISCOUNT_VALUE_INVALID',
      });
    }

    if (
      active.some(
        (discount) =>
          (discount.billItemId ?? null) === (dto.billItemId ?? null),
      )
    ) {
      throw new ConflictException({
        message: dto.billItemId
          ? 'La linea ya tiene un descuento activo. Anulalo antes de aplicar otro.'
          : 'La cuenta ya tiene un descuento activo. Anulalo antes de aplicar otro.',
        code: 'DISCOUNT_ALREADY_ACTIVE',
      });
    }

    const computed = computeDiscounts({
      lines: items.map((item) => ({
        billItemId: item.id,
        totalPrice: item.totalPrice,
      })),
      discounts: [
        ...active.map((discount) => ({
          id: discount.id,
          billItemId: discount.billItemId,
          type: discount.type,
          value: discount.value,
        })),
        {
          id: 'new',
          billItemId: dto.billItemId ?? null,
          type: dto.type,
          value,
        },
      ],
    });
    const newAmount = computed.itemAmounts.get('new') ?? ZERO;

    if (newAmount.lte(0)) {
      throw new BadRequestException({
        message: 'El descuento no tiene efecto sobre la cuenta.',
        code: 'DISCOUNT_NO_EFFECT',
      });
    }

    const subtotal = items.reduce((sum, i) => sum.add(i.totalPrice), ZERO);
    const max = maxDiscount(subtotal, bill.tipAmount, paidAmountOf(bill));

    if (computed.totalDiscount.gt(max)) {
      throw new ConflictException({
        message: 'El descuento supera lo que queda por cobrar de la cuenta.',
        code: 'DISCOUNT_EXCEEDS_REMAINING',
        maxDiscount: max.toString(),
      });
    }

    return {
      bill: { ...bill, subtotalAmount: subtotal },
      newAmount,
      totalDiscount: computed.totalDiscount,
      max,
      needsApproval: requiresApproval({
        isAdmin,
        subtotal,
        totalDiscount: computed.totalDiscount,
        thresholds: {
          percent: settings
            ? settings.discountApprovalPercent
            : new Prisma.Decimal(10),
          amount: settings?.discountApprovalAmount ?? null,
        },
      }),
    };
  }

  private async needsApproval(
    context: { staffUserId: string; restaurantId: string; isAdmin: boolean },
    branchId: string,
    billId: string,
    evaluation: Evaluation,
    dto: CreateBillDiscountDto,
  ) {
    const approvers = await this.approvalPinService.listApprovers(
      branchId,
      context.restaurantId,
    );

    await this.auditService.record(null, {
      restaurantId: context.restaurantId,
      branchId,
      actorStaffUserId: context.staffUserId,
      actorRole: Role.CASHIER,
      action: 'DISCOUNT_DENIED',
      entityType: 'Bill',
      entityId: billId,
      after: {
        code: 'DISCOUNT_NEEDS_APPROVAL',
        amount: evaluation.totalDiscount.toString(),
      },
      reason: dto.reasonText,
    });

    return new ForbiddenException({
      message:
        'Este descuento supera el limite permitido. Requiere el PIN de un administrador.',
      code: 'DISCOUNT_NEEDS_APPROVAL',
      requestedDiscount: evaluation.totalDiscount.toString(),
      approvers,
    });
  }

  private findByKey(billId: string, idempotencyKey: string) {
    return this.prisma.billDiscount.findUnique({
      where: { billId_idempotencyKey: { billId, idempotencyKey } },
      include: DISCOUNT_INCLUDE,
    });
  }

  private async replay(
    existing: NonNullable<Awaited<ReturnType<typeof this.findByKey>>>,
    staffUserId: string,
    fingerprint: string,
  ): Promise<BillDiscountResultDto> {
    if (
      existing.appliedByStaffUserId !== staffUserId ||
      existing.requestFingerprint !== fingerprint
    ) {
      throw new ConflictException({
        message: 'La Idempotency-Key ya se uso con otra solicitud.',
        code: 'DISCOUNT_IDEMPOTENCY_KEY_REUSED',
      });
    }

    const bill = await this.prisma.bill.findUniqueOrThrow({
      where: { id: existing.billId },
    });

    return {
      discount: mapDiscount(existing),
      bill: mapBillTotals(bill),
      splitCancelled: false,
      idempotentReplay: true,
    };
  }
}

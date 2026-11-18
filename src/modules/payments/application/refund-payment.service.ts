import { createHash } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  BranchRoleStatus,
  CashMovementType,
  Prisma,
  RefundMethod,
  RefundStatus,
  Role,
  StaffUserStatus,
} from '@prisma/client';
import { AuditService } from '../../../common/audit/audit.service';
import { BranchAccessService } from '../../../common/branch-access/branch-access.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import {
  addDaysToDateKey,
  zonedDateKey,
  zonedStartOfDay,
} from '../../../common/time/restaurant-time';
import { AuthService } from '../../auth/auth.service';
import type { JwtPayload } from '../../auth/interfaces/jwt-payload.interface';
import {
  computeRefundBreakdown,
  computeRefundNet,
  computeRefundable,
} from '../domain/refund-amounts';
import { resolveRefundMode } from '../domain/refund-mode';
import type {
  CreateRefundDto,
  RefundResultResponseDto,
} from '../presentation/http/dto/refunds.dto';
import { computeLineRefundAmount } from '../domain/refund-items';
import { lockBill } from '../../billing/application/lock-bill';
import { findOpenCashSessionId } from './find-open-cash-session';
import { RefundGatewayService } from './refund-gateway.service';
import {
  ACTIVE_ORDER_STATUSES,
  REFUND_INCLUDE,
  mapPaymentRefundState,
  mapRefund,
  type RefundRecord,
} from './refund-mapper';

export type RefundRequestMeta = {
  ip: string | null;
  userAgent: string | null;
};

export type ItemsRefundPlan = {
  billId: string;
  items: { billItemId: string; quantity: number; kitchenWaste?: boolean }[];
};

export type PlannedRefundLine = {
  billItemId: string;
  orderItemId: string | null;
  menuItemId: string | null;
  preparationStationId: string | null;
  name: string;
  categoryPath: string[];
  quantity: number;
  previousRefundedQuantity: number;
  discountAmount: Prisma.Decimal;
  availableQuantity: number;
  amount: Prisma.Decimal;
  kitchenWaste: boolean;
};

const APPROVAL_FAILURE_WINDOW_MS = 15 * 60 * 1000;
const APPROVAL_FAILURE_LIMIT = 5;

type RefundTransactionOutcome =
  | {
      kind: 'DONE';
      refund: RefundRecord;
      refundedAmount: Prisma.Decimal;
      refundedTipAmount: Prisma.Decimal;
      activeOrders: number;
    }
  | { kind: 'LOST' }
  | {
      kind: 'NEEDS_APPROVAL';
      limit: Prisma.Decimal;
      dayTotal: Prisma.Decimal;
      requiredTotal: Prisma.Decimal;
    };

@Injectable()
export class RefundPaymentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly branchAccessService: BranchAccessService,
    private readonly authService: AuthService,
    private readonly auditService: AuditService,
    private readonly refundGateway: RefundGatewayService,
  ) {}

  async execute(
    authUser: JwtPayload,
    branchId: string,
    paymentId: string,
    idempotencyKey: string,
    dto: CreateRefundDto,
    requestMeta: RefundRequestMeta,
    plan?: ItemsRefundPlan,
  ): Promise<RefundResultResponseDto> {
    const context = await this.branchAccessService.ensureAccess(
      authUser,
      branchId,
      [Role.ADMIN, Role.CASHIER],
      { fresh: true },
    );
    const isAdmin = context.roles.includes(Role.ADMIN);
    const requestedByRole = isAdmin ? Role.ADMIN : Role.CASHIER;
    let amount = new Prisma.Decimal(dto.amount);

    if (!plan && amount.lte(0)) {
      throw new BadRequestException({
        message: 'El monto debe ser mayor a cero.',
        code: 'REFUND_AMOUNT_INVALID',
      });
    }

    const payment = await this.loadPayment(branchId, paymentId);

    if (!payment) {
      throw new NotFoundException({
        message: 'El pago indicado no existe en esta sucursal.',
        code: 'PAYMENT_NOT_FOUND',
      });
    }

    if (plan && payment.billId !== plan.billId) {
      throw new NotFoundException({
        message: 'El pago indicado no pertenece a esta cuenta.',
        code: 'PAYMENT_NOT_FOUND',
      });
    }

    const timeZone = payment.bill.branch.restaurant.timezone;
    const now = new Date();
    const denied = (code: string, extra: Record<string, unknown> = {}) =>
      this.auditService.record(null, {
        restaurantId: context.restaurantId,
        branchId,
        actorStaffUserId: context.staffUserId,
        actorRole: requestedByRole,
        action: 'REFUND_DENIED',
        entityType: 'Payment',
        entityId: payment.id,
        after: { code, amount: amount.toString(), ...extra },
        reason: dto.reasonText,
        ip: requestMeta.ip,
        userAgent: requestMeta.userAgent,
      });

    const settings = await this.prisma.branchSettings.findUnique({
      where: { branchId },
    });
    const refundTip = dto.refundTip ?? settings?.refundTipDefault ?? false;
    let explicitTip =
      refundTip && dto.tipAmount !== undefined
        ? new Prisma.Decimal(dto.tipAmount)
        : undefined;
    let plannedLines: PlannedRefundLine[] = [];
    const fingerprint = createHash('sha256')
      .update(
        [
          amount.toFixed(2),
          refundTip ? '1' : '0',
          explicitTip?.toFixed(2) ?? '',
          dto.reasonCode,
          dto.reasonText.trim(),
          ...(dto.registerAsManual ? ['manual'] : []),
          ...(plan?.items ?? []).map(
            (item) =>
              `${item.billItemId}:${item.quantity}:${item.kitchenWaste ? 1 : 0}`,
          ),
        ].join('|'),
      )
      .digest('hex');

    const existing = await this.findByKey(paymentId, idempotencyKey);

    if (existing) {
      return this.replay(existing, context.staffUserId, fingerprint);
    }

    if (plan) {
      const planned = await this.planItems(payment, plan, refundTip);

      plannedLines = planned.lines;
      amount = planned.amount;
      explicitTip = refundTip ? planned.tipAmount : undefined;
    }

    const mode = resolveRefundMode({
      payment,
      isAdmin,
      now,
      timeZone,
      registerAsManual: dto.registerAsManual,
    });

    if (!mode.allowed) {
      if (mode.code === 'REFUND_PAYMENT_NOT_PAID') {
        throw new ConflictException({
          message: mode.message,
          code: mode.code,
        });
      }

      await denied(mode.code);
      throw new ForbiddenException({ message: mode.message, code: mode.code });
    }

    const breakdown = computeRefundBreakdown(payment, {
      amount,
      refundTip,
      tipAmount:
        plan || dto.tipAmount === undefined
          ? explicitTip
          : new Prisma.Decimal(dto.tipAmount),
    });

    if (!breakdown.ok) {
      throw new BadRequestException({
        message: breakdown.message,
        code: breakdown.code,
        refundable: {
          total: breakdown.refundable.total.toString(),
          consumption: breakdown.refundable.consumption.toString(),
          tip: breakdown.refundable.tip.toString(),
        },
      });
    }

    const { tipAmount, consumptionAmount } = breakdown.breakdown;

    let approvedByStaffUserId: string | null = null;
    let approvalInfo: { limit: string; requiredTotal: string } | null = null;

    const limit = isAdmin ? null : (settings?.cashierRefundLimit ?? null);
    const todayKey = zonedDateKey(now, timeZone);
    const dayStart = zonedStartOfDay(todayKey, timeZone);
    const dayEnd = zonedStartOfDay(addDaysToDateKey(todayKey, 1), timeZone);

    const needsApproval = async (
      cap: Prisma.Decimal,
      dayTotal: Prisma.Decimal,
      requiredTotal: Prisma.Decimal,
    ) => {
      const approvers = await this.listApprovers(
        branchId,
        context.restaurantId,
      );
      await denied('REFUND_NEEDS_APPROVAL', {
        limit: cap.toString(),
        requiredTotal: requiredTotal.toString(),
      });
      return new ForbiddenException({
        message:
          'Este reembolso supera el limite diario del cajero. Requiere el PIN de un administrador.',
        code: 'REFUND_NEEDS_APPROVAL',
        limit: cap.toString(),
        dayRefunded: dayTotal.toString(),
        requiredTotal: requiredTotal.toString(),
        approvers,
      });
    };

    if (limit !== null) {
      const dayTotal = await this.cashierDayTotal(
        this.prisma,
        context.staffUserId,
        branchId,
        dayStart,
        dayEnd,
      );
      const requiredTotal = dayTotal.add(amount);

      if (requiredTotal.gt(limit)) {
        if (!dto.approverStaffUserId || !dto.approverPin) {
          throw await needsApproval(limit, dayTotal, requiredTotal);
        }

        approvedByStaffUserId = await this.approve(
          context,
          branchId,
          payment.id,
          dto.approverStaffUserId,
          dto.approverPin,
          requestMeta,
          now,
        );
        approvalInfo = {
          limit: limit.toString(),
          requiredTotal: requiredTotal.toString(),
        };
      }
    }

    const method = mode.method;
    const isGateway = method === RefundMethod.GATEWAY;
    const reasonText = dto.reasonText.trim();

    let outcome: RefundTransactionOutcome;

    try {
      outcome = await this.prisma.$transaction(async (tx) => {
        if (plannedLines.length > 0) {
          await lockBill(tx, payment.billId);
        }

        if (limit !== null && !approvedByStaffUserId) {
          await tx.$executeRaw(
            Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`refund-limit:${context.staffUserId}:${branchId}`}))`,
          );
          const lockedDayTotal = await this.cashierDayTotal(
            tx,
            context.staffUserId,
            branchId,
            dayStart,
            dayEnd,
          );
          const lockedRequiredTotal = lockedDayTotal.add(amount);

          if (lockedRequiredTotal.gt(limit)) {
            return {
              kind: 'NEEDS_APPROVAL',
              limit,
              dayTotal: lockedDayTotal,
              requiredTotal: lockedRequiredTotal,
            } as const;
          }
        }

        const updated = await tx.$queryRaw<
          {
            refunded_amount: Prisma.Decimal;
            refunded_tip_amount: Prisma.Decimal;
          }[]
        >(Prisma.sql`
          UPDATE payments
          SET refunded_amount = refunded_amount + ${amount.toFixed(2)}::numeric,
              refunded_tip_amount = refunded_tip_amount + ${tipAmount.toFixed(2)}::numeric
          WHERE id = ${payment.id}::uuid
            AND status = 'PAID'
            AND refunded_amount + ${amount.toFixed(2)}::numeric <= amount
            AND refunded_tip_amount + ${tipAmount.toFixed(2)}::numeric <= tip_amount
            AND (refunded_amount - refunded_tip_amount) + (${amount.toFixed(2)}::numeric - ${tipAmount.toFixed(2)}::numeric) <= (amount - tip_amount)
          RETURNING refunded_amount, refunded_tip_amount
        `);

        if (updated.length === 0) {
          return { kind: 'LOST' } as const;
        }

        const refundedAmount = new Prisma.Decimal(
          updated[0].refunded_amount.toString(),
        );
        const refundedTipAmount = new Prisma.Decimal(
          updated[0].refunded_tip_amount.toString(),
        );
        const consumptionBefore = refundedAmount
          .sub(refundedTipAmount)
          .sub(consumptionAmount);
        const { netAmount, vatAmount } = computeRefundNet(
          consumptionBefore,
          consumptionAmount,
        );

        for (const line of plannedLines) {
          const changed = await tx.$executeRaw(Prisma.sql`
            UPDATE bill_items
            SET refunded_quantity = refunded_quantity + ${line.quantity},
                updated_at = now()
            WHERE id = ${line.billItemId}::uuid
              AND status::text = 'OPEN'
              AND refunded_quantity = ${line.previousRefundedQuantity}
              AND discount_amount = ${line.discountAmount.toFixed(2)}::numeric
              AND refunded_quantity + ${line.quantity} <= quantity
          `);

          if (changed === 0) {
            throw new ConflictException({
              message:
                'Las cantidades reembolsables de la cuenta cambiaron. Recarga e intenta de nuevo.',
              code: 'REFUND_ITEMS_CONFLICT',
            });
          }
        }

        const refund = await tx.refund.create({
          data: {
            restaurantId: context.restaurantId,
            branchId,
            billId: payment.billId,
            paymentId: payment.id,
            amount,
            tipAmount,
            netAmount,
            vatAmount,
            status: isGateway ? RefundStatus.PENDING : RefundStatus.SUCCEEDED,
            method,
            reasonCode: dto.reasonCode,
            reasonText,
            idempotencyKey,
            requestFingerprint: fingerprint,
            provider: payment.provider,
            requestedByStaffUserId: context.staffUserId,
            requestedByRole,
            approvedByStaffUserId,
            source: 'STAFF',
            creditNoteStatus: consumptionAmount.gt(0)
              ? 'PENDING'
              : 'NOT_REQUIRED',
            completedAt: isGateway ? null : now,
            ...(plannedLines.length > 0
              ? {
                  items: {
                    create: plannedLines.map((line) => ({
                      billItemId: line.billItemId,
                      orderItemId: line.orderItemId,
                      menuItemId: line.menuItemId,
                      preparationStationId: line.preparationStationId,
                      nameSnapshot: line.name,
                      categoryPathSnapshot: line.categoryPath,
                      quantity: line.quantity,
                      amount: line.amount,
                      kitchenWaste: line.kitchenWaste,
                    })),
                  },
                }
              : {}),
          },
          include: REFUND_INCLUDE,
        });

        const bill = await tx.bill.update({
          where: { id: payment.billId },
          data: { refundedAmount: { increment: amount } },
          select: { refundedAmount: true },
        });

        let cashMovementId: string | null = null;

        if (method === RefundMethod.CASH_MANUAL) {
          const cashSessionId = await findOpenCashSessionId(
            tx,
            branchId,
            context.staffUserId,
          );

          if (!cashSessionId && settings?.requireOpenCashSession) {
            throw new ConflictException({
              message: 'Debes abrir tu caja antes de registrar este reembolso.',
              code: 'CASH_SESSION_REQUIRED',
            });
          }

          const movement = await tx.cashMovement.create({
            data: {
              branchId,
              type: CashMovementType.REFUND_OUT,
              amount: amount.neg(),
              reason: reasonText,
              paymentId: payment.id,
              refundId: refund.id,
              cashSessionId,
              staffUserId: context.staffUserId,
            },
            select: { id: true },
          });
          cashMovementId = movement.id;
        }

        const orders = await tx.order.findMany({
          where: { billId: payment.billId },
          select: { id: true, status: true },
        });

        await this.auditService.record(tx, {
          restaurantId: context.restaurantId,
          branchId,
          actorStaffUserId: context.staffUserId,
          actorRole: requestedByRole,
          action: isGateway
            ? 'REFUND_REQUESTED'
            : method === RefundMethod.CASH_MANUAL
              ? 'REFUND_SUCCEEDED'
              : 'REFUND_REGISTERED_MANUAL',
          entityType: 'Refund',
          entityId: refund.id,
          before: {
            paymentRefundedAmount: refundedAmount.sub(amount).toString(),
            paymentRefundedTipAmount: refundedTipAmount
              .sub(tipAmount)
              .toString(),
            billRefundedAmount: bill.refundedAmount.sub(amount).toString(),
          },
          after: {
            paymentId: payment.id,
            billId: payment.billId,
            amount: amount.toString(),
            tipAmount: tipAmount.toString(),
            netAmount: netAmount.toString(),
            vatAmount: vatAmount.toString(),
            method,
            reasonCode: dto.reasonCode,
            idempotencyKey,
            approvedByStaffUserId,
            paymentRefundedAmount: refundedAmount.toString(),
            paymentRefundedTipAmount: refundedTipAmount.toString(),
            billRefundedAmount: bill.refundedAmount.toString(),
            cashMovementId,
            ...(plannedLines.length > 0
              ? {
                  items: plannedLines.map((line) => ({
                    billItemId: line.billItemId,
                    name: line.name,
                    quantity: line.quantity,
                    amount: line.amount.toString(),
                    kitchenWaste: line.kitchenWaste,
                  })),
                }
              : {}),
            orders: orders.map((order) => ({
              id: order.id,
              status: order.status,
            })),
            ...(method === RefundMethod.MANUAL_EXTERNAL
              ? {
                  provider: payment.provider,
                  gatewayRefundDoneOutsideSazono: true,
                }
              : {}),
          },
          reason: reasonText,
          ip: requestMeta.ip,
          userAgent: requestMeta.userAgent,
        });

        if (approvedByStaffUserId && approvalInfo) {
          await this.auditService.record(tx, {
            restaurantId: context.restaurantId,
            branchId,
            actorStaffUserId: approvedByStaffUserId,
            actorRole: Role.ADMIN,
            action: 'REFUND_APPROVED',
            entityType: 'Refund',
            entityId: refund.id,
            after: {
              approverStaffUserId: approvedByStaffUserId,
              limit: approvalInfo.limit,
              requiredTotal: approvalInfo.requiredTotal,
            },
            reason: reasonText,
            ip: requestMeta.ip,
            userAgent: requestMeta.userAgent,
          });
        }

        return {
          kind: 'DONE',
          refund,
          refundedAmount,
          refundedTipAmount,
          activeOrders: orders.filter((order) =>
            ACTIVE_ORDER_STATUSES.includes(order.status),
          ).length,
        } as const;
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        outcome = { kind: 'LOST' };
      } else {
        throw error;
      }
    }

    if (outcome.kind === 'NEEDS_APPROVAL') {
      throw await needsApproval(
        outcome.limit,
        outcome.dayTotal,
        outcome.requiredTotal,
      );
    }

    if (outcome.kind === 'LOST') {
      const raced = await this.findByKey(paymentId, idempotencyKey);

      if (raced) {
        return this.replay(raced, context.staffUserId, fingerprint);
      }

      throw new ConflictException({
        message:
          'El saldo reembolsable del pago cambio. Recarga e intenta de nuevo.',
        code: 'REFUND_CONFLICT',
      });
    }

    if (isGateway) {
      const settled = await this.refundGateway.dispatch(outcome.refund.id, {
        staffUserId: context.staffUserId,
        role: requestedByRole,
        ip: requestMeta.ip,
        userAgent: requestMeta.userAgent,
      });

      if (settled) {
        return this.refundGateway.toResult(settled, false);
      }
    }

    return {
      refund: mapRefund(outcome.refund),
      payment: mapPaymentRefundState({
        id: payment.id,
        amount: payment.amount,
        tipAmount: payment.tipAmount,
        refundedAmount: outcome.refundedAmount,
        refundedTipAmount: outcome.refundedTipAmount,
      }),
      cashToHandOver:
        method === RefundMethod.CASH_MANUAL ? amount.toString() : null,
      billActiveOrders: outcome.activeOrders,
      idempotentReplay: false,
    };
  }

  async planItems(
    payment: Prisma.PaymentGetPayload<object>,
    plan: ItemsRefundPlan,
    refundTip: boolean,
  ): Promise<{
    lines: PlannedRefundLine[];
    amount: Prisma.Decimal;
    consumptionAmount: Prisma.Decimal;
    tipAmount: Prisma.Decimal;
  }> {
    const ids = plan.items.map((item) => item.billItemId);

    if (new Set(ids).size !== ids.length) {
      throw new BadRequestException({
        message: 'Una linea no puede repetirse en la solicitud.',
        code: 'REFUND_ITEMS_DUPLICATED',
      });
    }

    const billItems = await this.prisma.billItem.findMany({
      where: { id: { in: ids }, billId: plan.billId, status: 'OPEN' },
      include: {
        orderItem: {
          select: {
            menuItemId: true,
            preparationStationId: true,
            nameSnapshot: true,
            categoryPathSnapshot: true,
          },
        },
        refundItems: {
          where: { refund: { status: { not: RefundStatus.FAILED } } },
          select: { amount: true },
        },
      },
    });
    const byId = new Map(billItems.map((item) => [item.id, item]));
    const lines: PlannedRefundLine[] = [];

    for (const requested of plan.items) {
      const item = byId.get(requested.billItemId);

      if (!item) {
        throw new NotFoundException({
          message: 'Una de las lineas no existe en esta cuenta.',
          code: 'BILL_ITEM_NOT_FOUND',
        });
      }

      const availableQuantity = item.quantity - item.refundedQuantity;

      if (requested.quantity > availableQuantity) {
        throw new ConflictException({
          message: `No quedan ${requested.quantity} unidades reembolsables de ${item.description}.`,
          code: 'REFUND_ITEM_QUANTITY_EXCEEDED',
          billItemId: item.id,
          availableQuantity,
        });
      }

      const refundedAmount = item.refundItems.reduce(
        (sum, refundItem) => sum.add(refundItem.amount),
        new Prisma.Decimal(0),
      );

      lines.push({
        billItemId: item.id,
        orderItemId: item.orderItemId,
        menuItemId: item.orderItem?.menuItemId ?? null,
        preparationStationId: item.orderItem?.preparationStationId ?? null,
        name: item.orderItem?.nameSnapshot ?? item.description,
        categoryPath: item.orderItem?.categoryPathSnapshot ?? [],
        quantity: requested.quantity,
        previousRefundedQuantity: item.refundedQuantity,
        discountAmount: item.discountAmount,
        availableQuantity,
        amount: computeLineRefundAmount({
          quantity: item.quantity,
          refundedQuantity: item.refundedQuantity,
          netAmount: item.totalPrice.sub(item.discountAmount),
          refundedAmount,
          requested: requested.quantity,
        }),
        kitchenWaste: requested.kitchenWaste ?? false,
      });
    }

    const consumptionAmount = lines.reduce(
      (sum, line) => sum.add(line.amount),
      new Prisma.Decimal(0),
    );
    const refundable = computeRefundable(payment);
    const paymentConsumption = payment.amount.sub(payment.tipAmount);
    let tipAmount = new Prisma.Decimal(0);

    if (refundTip && paymentConsumption.gt(0)) {
      tipAmount = Prisma.Decimal.min(
        refundable.tip,
        consumptionAmount
          .mul(payment.tipAmount)
          .div(paymentConsumption)
          .toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP),
      );
    }

    if (consumptionAmount.gt(refundable.consumption)) {
      throw new ConflictException({
        message: `Los productos suman mas de lo reembolsable de este pago (maximo ${refundable.consumption.toString()}).`,
        code: 'REFUND_ITEMS_EXCEED_PAYMENT',
        refundable: {
          total: refundable.total.toString(),
          consumption: refundable.consumption.toString(),
          tip: refundable.tip.toString(),
        },
      });
    }

    const amount = consumptionAmount.add(tipAmount);

    if (amount.lte(0)) {
      throw new BadRequestException({
        message: 'El monto a reembolsar debe ser mayor a cero.',
        code: 'REFUND_AMOUNT_INVALID',
      });
    }

    return { lines, amount, consumptionAmount, tipAmount };
  }

  private loadPayment(branchId: string, paymentId: string) {
    return this.prisma.payment.findFirst({
      where: { id: paymentId, bill: { branchId } },
      include: {
        bill: {
          select: {
            id: true,
            status: true,
            branchId: true,
            branch: {
              select: { restaurant: { select: { timezone: true } } },
            },
          },
        },
      },
    });
  }

  private findByKey(paymentId: string, idempotencyKey: string) {
    return this.prisma.refund.findUnique({
      where: { paymentId_idempotencyKey: { paymentId, idempotencyKey } },
      include: REFUND_INCLUDE,
    });
  }

  private async replay(
    existing: RefundRecord,
    staffUserId: string,
    fingerprint: string,
  ): Promise<RefundResultResponseDto> {
    if (
      existing.requestedByStaffUserId !== staffUserId ||
      existing.requestFingerprint !== fingerprint
    ) {
      throw new ConflictException({
        message: 'La Idempotency-Key ya se uso con otra solicitud.',
        code: 'REFUND_IDEMPOTENCY_KEY_REUSED',
      });
    }

    const payment = await this.prisma.payment.findUniqueOrThrow({
      where: { id: existing.paymentId },
    });
    const activeOrders = await this.prisma.order.count({
      where: {
        billId: existing.billId,
        status: { in: ACTIVE_ORDER_STATUSES },
      },
    });

    return {
      refund: mapRefund(existing),
      payment: mapPaymentRefundState(payment),
      cashToHandOver:
        existing.method === RefundMethod.CASH_MANUAL
          ? existing.amount.toString()
          : null,
      billActiveOrders: activeOrders,
      idempotentReplay: true,
    };
  }

  private async cashierDayTotal(
    client: Prisma.TransactionClient,
    staffUserId: string,
    branchId: string,
    start: Date,
    end: Date,
  ): Promise<Prisma.Decimal> {
    const result = await client.refund.aggregate({
      _sum: { amount: true },
      where: {
        branchId,
        status: RefundStatus.SUCCEEDED,
        requestedByStaffUserId: staffUserId,
        approvedByStaffUserId: null,
        completedAt: { gte: start, lt: end },
      },
    });

    return result._sum.amount ?? new Prisma.Decimal(0);
  }

  private async listApprovers(branchId: string, restaurantId: string) {
    const roles = await this.prisma.staffUserBranchRole.findMany({
      where: {
        branchId,
        role: Role.ADMIN,
        status: BranchRoleStatus.ACTIVE,
        staffUser: {
          status: StaffUserStatus.ACTIVE,
          restaurantId,
          pinHash: { not: null },
        },
      },
      select: {
        staffUser: { select: { id: true, firstName: true, lastName: true } },
      },
    });

    return roles.map((role) => ({
      staffUserId: role.staffUser.id,
      name: `${role.staffUser.firstName} ${role.staffUser.lastName}`.trim(),
    }));
  }

  private async approve(
    context: { staffUserId: string; restaurantId: string },
    branchId: string,
    paymentId: string,
    approverStaffUserId: string,
    approverPin: string,
    requestMeta: RefundRequestMeta,
    now: Date,
  ): Promise<string> {
    const recentFailures = await this.prisma.auditLog.count({
      where: {
        actorStaffUserId: context.staffUserId,
        action: 'REFUND_APPROVAL_FAILED',
        createdAt: {
          gte: new Date(now.getTime() - APPROVAL_FAILURE_WINDOW_MS),
        },
      },
    });

    if (recentFailures >= APPROVAL_FAILURE_LIMIT) {
      throw new ForbiddenException({
        message:
          'Demasiados intentos de aprobacion fallidos. Pide a un administrador que registre el reembolso.',
        code: 'REFUND_APPROVAL_BLOCKED',
      });
    }

    const approverRole = await this.prisma.staffUserBranchRole.findFirst({
      where: {
        branchId,
        role: Role.ADMIN,
        status: BranchRoleStatus.ACTIVE,
        staffUserId: approverStaffUserId,
        staffUser: {
          status: StaffUserStatus.ACTIVE,
          restaurantId: context.restaurantId,
        },
      },
      include: {
        staffUser: {
          select: {
            id: true,
            pinHash: true,
            pinFailedAttempts: true,
            pinLockedUntil: true,
            approvalPinFailedAttempts: true,
            approvalPinLockedUntil: true,
          },
        },
      },
    });

    if (
      !approverRole ||
      !approverRole.staffUser.pinHash ||
      approverRole.staffUser.id === context.staffUserId
    ) {
      throw new ForbiddenException({
        message:
          'El aprobador indicado no es un administrador activo de esta sucursal con PIN configurado.',
        code: 'REFUND_APPROVER_INVALID',
      });
    }

    const result = await this.authService.verifyStaffPin(
      approverRole.staffUser,
      approverPin,
      'APPROVAL',
    );

    if (result === 'OK') {
      return approverRole.staffUser.id;
    }

    if (result === 'LOCKED') {
      throw new ForbiddenException({
        message:
          'PIN bloqueado temporalmente por demasiados intentos fallidos.',
        code: 'REFUND_PIN_LOCKED',
      });
    }

    await this.auditService.record(null, {
      restaurantId: context.restaurantId,
      branchId,
      actorStaffUserId: context.staffUserId,
      actorRole: Role.CASHIER,
      action: 'REFUND_APPROVAL_FAILED',
      entityType: 'StaffUser',
      entityId: approverRole.staffUser.id,
      after: { paymentId, reason: result },
      ip: requestMeta.ip,
      userAgent: requestMeta.userAgent,
    });

    throw new ForbiddenException({
      message: 'PIN invalido.',
      code: 'REFUND_PIN_INVALID',
    });
  }
}

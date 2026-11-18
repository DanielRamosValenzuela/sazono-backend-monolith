import { Injectable, NotFoundException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { BranchAccessService } from '../../../common/branch-access/branch-access.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { zonedDateKey } from '../../../common/time/restaurant-time';
import type { JwtPayload } from '../../auth/interfaces/jwt-payload.interface';
import {
  resolveRefundMode,
  supportsGatewayRefund,
} from '../domain/refund-mode';
import type { PaymentRefundsResponseDto } from '../presentation/http/dto/refunds.dto';
import {
  REFUND_INCLUDE,
  mapPaymentRefundState,
  mapRefund,
} from './refund-mapper';

const ROLE_NOT_ALLOWED_MESSAGE =
  'Tu rol puede ver los reembolsos pero no registrarlos.';

function readInstallments(gatewayMeta: unknown): number | null {
  const value =
    gatewayMeta && typeof gatewayMeta === 'object'
      ? (gatewayMeta as Record<string, unknown>).installments
      : null;

  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

@Injectable()
export class ListPaymentRefundsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly branchAccessService: BranchAccessService,
  ) {}

  async execute(
    authUser: JwtPayload,
    branchId: string,
    paymentId: string,
  ): Promise<PaymentRefundsResponseDto> {
    const context = await this.branchAccessService.ensureAccess(
      authUser,
      branchId,
      [Role.ADMIN, Role.SUPERVISOR, Role.CASHIER],
    );
    const isAdmin = context.roles.includes(Role.ADMIN);
    const canRefund = isAdmin || context.roles.includes(Role.CASHIER);
    const seesEverything = isAdmin || context.roles.includes(Role.SUPERVISOR);

    const payment = await this.prisma.payment.findFirst({
      where: { id: paymentId, bill: { branchId } },
      include: {
        bill: {
          select: {
            branch: {
              select: { restaurant: { select: { timezone: true } } },
            },
          },
        },
      },
    });

    const timeZone = payment?.bill.branch.restaurant.timezone ?? '';
    const hiddenFromCashier =
      !seesEverything &&
      payment !== null &&
      (payment.staffUserId !== context.staffUserId ||
        !payment.paidAt ||
        zonedDateKey(payment.paidAt, timeZone) !==
          zonedDateKey(new Date(), timeZone));

    if (!payment || hiddenFromCashier) {
      throw new NotFoundException({
        message: 'El pago indicado no existe en esta sucursal.',
        code: 'PAYMENT_NOT_FOUND',
      });
    }

    const [settings, refunds] = await Promise.all([
      this.prisma.branchSettings.findUnique({ where: { branchId } }),
      this.prisma.refund.findMany({
        where: {
          paymentId,
          ...(seesEverything
            ? {}
            : { requestedByStaffUserId: context.staffUserId }),
        },
        include: REFUND_INCLUDE,
        orderBy: [{ createdAt: 'asc' }],
      }),
    ]);

    const state = mapPaymentRefundState(payment);
    const mode = canRefund
      ? resolveRefundMode({
          payment,
          isAdmin,
          now: new Date(),
          timeZone: payment.bill.branch.restaurant.timezone,
        })
      : null;

    return {
      payment: {
        ...state,
        billId: payment.billId,
        method: payment.method,
        provider: payment.provider,
        status: payment.status,
        consumptionAmount: payment.amount.sub(payment.tipAmount).toString(),
        paidAt: payment.paidAt?.toISOString() ?? null,
        disputed: payment.disputed ?? false,
        installments: readInstallments(payment.gatewayMeta),
        gatewayRefundSupported: supportsGatewayRefund(payment),
      },
      settings: {
        cashierRefundLimit: settings?.cashierRefundLimit?.toString() ?? null,
        refundTipDefault: settings?.refundTipDefault ?? false,
      },
      eligibility: mode
        ? mode.allowed
          ? {
              allowed: true,
              method: mode.method,
              deniedCode: null,
              deniedMessage: null,
              canManageGateway: isAdmin,
            }
          : {
              allowed: false,
              method: mode.method,
              deniedCode: mode.code,
              deniedMessage: mode.message,
              canManageGateway: isAdmin,
            }
        : {
            allowed: false,
            method: null,
            deniedCode: 'REFUND_ROLE_NOT_ALLOWED',
            deniedMessage: ROLE_NOT_ALLOWED_MESSAGE,
            canManageGateway: false,
          },
      refunds: refunds.map(mapRefund),
    };
  }
}

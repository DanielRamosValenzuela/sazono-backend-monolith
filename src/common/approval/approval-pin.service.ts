import { ForbiddenException, Injectable } from '@nestjs/common';
import { BranchRoleStatus, Role, StaffUserStatus } from '@prisma/client';
import { AuthService } from '../../modules/auth/auth.service';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';

const APPROVAL_FAILURE_WINDOW_MS = 15 * 60 * 1000;
const APPROVAL_FAILURE_LIMIT = 5;

export type ApprovalRequestMeta = {
  ip: string | null;
  userAgent: string | null;
};

export type ApprovalVerifyOptions = {
  failureAction: string;
  codePrefix: string;
  entityContext: Record<string, string>;
  blockedMessage: string;
};

@Injectable()
export class ApprovalPinService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authService: AuthService,
    private readonly auditService: AuditService,
  ) {}

  async listApprovers(branchId: string, restaurantId: string) {
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

  async verify(
    context: { staffUserId: string; restaurantId: string },
    branchId: string,
    approverStaffUserId: string,
    approverPin: string,
    requestMeta: ApprovalRequestMeta,
    options: ApprovalVerifyOptions,
  ): Promise<string> {
    const recentFailures = await this.prisma.auditLog.count({
      where: {
        actorStaffUserId: context.staffUserId,
        action: { endsWith: '_APPROVAL_FAILED' },
        createdAt: {
          gte: new Date(Date.now() - APPROVAL_FAILURE_WINDOW_MS),
        },
      },
    });

    if (recentFailures >= APPROVAL_FAILURE_LIMIT) {
      throw new ForbiddenException({
        message: options.blockedMessage,
        code: `${options.codePrefix}_APPROVAL_BLOCKED`,
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
        code: `${options.codePrefix}_APPROVER_INVALID`,
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
        code: `${options.codePrefix}_PIN_LOCKED`,
      });
    }

    await this.auditService.record(null, {
      restaurantId: context.restaurantId,
      branchId,
      actorStaffUserId: context.staffUserId,
      actorRole: Role.CASHIER,
      action: options.failureAction,
      entityType: 'StaffUser',
      entityId: approverRole.staffUser.id,
      after: { ...options.entityContext, reason: result },
      ip: requestMeta.ip,
      userAgent: requestMeta.userAgent,
    });

    throw new ForbiddenException({
      message: 'PIN invalido.',
      code: `${options.codePrefix}_PIN_INVALID`,
    });
  }
}

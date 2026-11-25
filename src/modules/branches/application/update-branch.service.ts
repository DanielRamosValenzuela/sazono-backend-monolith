import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { AuditService } from '../../../common/audit/audit.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type { JwtPayload } from '../../auth/interfaces/jwt-payload.interface';
import { BranchAccessService } from '../../../common/branch-access/branch-access.service';
import { mapBranchToResponse } from './branch-mapper';
import type {
  BranchResponseDto,
  UpdateBranchDto,
} from '../presentation/http/dto/branch.dto';

@Injectable()
export class UpdateBranchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly branchAccessService: BranchAccessService,
    private readonly auditService: AuditService,
  ) {}

  async execute(
    authUser: JwtPayload,
    branchId: string,
    dto: UpdateBranchDto,
  ): Promise<BranchResponseDto> {
    const context = await this.branchAccessService.getStaffContext(authUser);

    const hasChanges =
      dto.name !== undefined ||
      dto.address !== undefined ||
      dto.status !== undefined ||
      dto.settings !== undefined;

    if (!hasChanges) {
      throw new BadRequestException(
        'Debes enviar al menos un campo para actualizar.',
      );
    }

    const branch = await this.prisma.branch.findFirst({
      where: {
        id: branchId,
        restaurantId: context.restaurantId,
      },
      select: {
        id: true,
      },
    });

    if (!branch) {
      throw new NotFoundException(
        'La sucursal no existe en el restaurante autenticado.',
      );
    }

    if (!context.adminBranchIds.has(branchId)) {
      throw new ForbiddenException(
        'Debes tener rol ADMIN en la sucursal para actualizarla.',
      );
    }

    const updatedBranch = await this.prisma.$transaction(async (tx) => {
      const data: Prisma.BranchUpdateInput = {};

      if (dto.name !== undefined) {
        data.name = dto.name;
      }

      if (dto.address !== undefined) {
        data.address = dto.address;
      }

      if (dto.status !== undefined) {
        data.status = dto.status;
      }

      if (Object.keys(data).length > 0) {
        await tx.branch.update({
          where: {
            id: branchId,
          },
          data,
        });
      }

      if (dto.settings !== undefined) {
        const settingsUpdate: Prisma.BranchSettingsUpdateInput = {};

        if (dto.settings.qrOrderingEnabled !== undefined) {
          settingsUpdate.qrOrderingEnabled = dto.settings.qrOrderingEnabled;
        }

        if (dto.settings.qrPaymentMode !== undefined) {
          settingsUpdate.qrPaymentMode = dto.settings.qrPaymentMode;
        }

        if (dto.settings.splitBillEnabled !== undefined) {
          settingsUpdate.splitBillEnabled = dto.settings.splitBillEnabled;
        }

        if (dto.settings.partialDeliveryEnabled !== undefined) {
          settingsUpdate.partialDeliveryEnabled =
            dto.settings.partialDeliveryEnabled;
        }

        if (dto.settings.autoDeliverAfterMinutes !== undefined) {
          settingsUpdate.autoDeliverAfterMinutes =
            dto.settings.autoDeliverAfterMinutes;
        }

        if (dto.settings.tableAssignmentEnabled !== undefined) {
          settingsUpdate.tableAssignmentEnabled =
            dto.settings.tableAssignmentEnabled;
        }

        if (dto.settings.cashierRefundLimit !== undefined) {
          settingsUpdate.cashierRefundLimit = dto.settings.cashierRefundLimit;
        }

        if (dto.settings.refundTipDefault !== undefined) {
          settingsUpdate.refundTipDefault = dto.settings.refundTipDefault;
        }

        if (dto.settings.discountApprovalPercent !== undefined) {
          settingsUpdate.discountApprovalPercent =
            dto.settings.discountApprovalPercent;
        }

        if (dto.settings.discountApprovalAmount !== undefined) {
          settingsUpdate.discountApprovalAmount =
            dto.settings.discountApprovalAmount;
        }

        if (dto.settings.requireOpenCashSession !== undefined) {
          settingsUpdate.requireOpenCashSession =
            dto.settings.requireOpenCashSession;
        }

        if (dto.settings.businessDayStartHour !== undefined) {
          settingsUpdate.businessDayStartHour =
            dto.settings.businessDayStartHour;
        }

        const cashSettingsTouched =
          dto.settings.requireOpenCashSession !== undefined;
        const cashSettingsBefore = cashSettingsTouched
          ? await tx.branchSettings.findUnique({
              where: { branchId },
              select: { requireOpenCashSession: true },
            })
          : null;

        const discountSettingsTouched =
          dto.settings.discountApprovalPercent !== undefined ||
          dto.settings.discountApprovalAmount !== undefined;
        const discountSettingsBefore = discountSettingsTouched
          ? await tx.branchSettings.findUnique({
              where: { branchId },
              select: {
                discountApprovalPercent: true,
                discountApprovalAmount: true,
              },
            })
          : null;

        const refundSettingsTouched =
          dto.settings.cashierRefundLimit !== undefined ||
          dto.settings.refundTipDefault !== undefined;
        const refundSettingsBefore = refundSettingsTouched
          ? await tx.branchSettings.findUnique({
              where: { branchId },
              select: { cashierRefundLimit: true, refundTipDefault: true },
            })
          : null;

        const savedSettings = await tx.branchSettings.upsert({
          where: {
            branchId,
          },
          update: settingsUpdate,
          create: {
            branchId,
            qrOrderingEnabled: dto.settings.qrOrderingEnabled ?? true,
            qrPaymentMode: dto.settings.qrPaymentMode ?? 'prepaid_order',
            splitBillEnabled: dto.settings.splitBillEnabled ?? true,
            partialDeliveryEnabled: dto.settings.partialDeliveryEnabled ?? true,
            autoDeliverAfterMinutes:
              dto.settings.autoDeliverAfterMinutes ?? null,
            tableAssignmentEnabled:
              dto.settings.tableAssignmentEnabled ?? false,
            cashierRefundLimit: dto.settings.cashierRefundLimit ?? null,
            refundTipDefault: dto.settings.refundTipDefault ?? false,
            ...(dto.settings.discountApprovalPercent !== undefined
              ? {
                  discountApprovalPercent: dto.settings.discountApprovalPercent,
                }
              : {}),
            ...(dto.settings.discountApprovalAmount !== undefined
              ? { discountApprovalAmount: dto.settings.discountApprovalAmount }
              : {}),
            ...(dto.settings.requireOpenCashSession !== undefined
              ? { requireOpenCashSession: dto.settings.requireOpenCashSession }
              : {}),
            ...(dto.settings.businessDayStartHour !== undefined
              ? { businessDayStartHour: dto.settings.businessDayStartHour }
              : {}),
          },
        });

        if (cashSettingsTouched) {
          const before = {
            requireOpenCashSession:
              cashSettingsBefore?.requireOpenCashSession ?? false,
          };
          const after = {
            requireOpenCashSession: savedSettings.requireOpenCashSession,
          };

          if (JSON.stringify(before) !== JSON.stringify(after)) {
            await this.auditService.record(tx, {
              restaurantId: context.restaurantId,
              branchId,
              actorStaffUserId: context.staffUserId,
              actorRole: Role.ADMIN,
              action: 'BRANCH_CASH_SETTINGS_CHANGED',
              entityType: 'BranchSettings',
              entityId: branchId,
              before,
              after,
            });
          }
        }

        if (discountSettingsTouched) {
          const toDiscountJson = (
            value: {
              discountApprovalPercent: Prisma.Decimal | null;
              discountApprovalAmount: Prisma.Decimal | null;
            } | null,
          ) => ({
            discountApprovalPercent:
              value?.discountApprovalPercent?.toString() ?? null,
            discountApprovalAmount:
              value?.discountApprovalAmount?.toString() ?? null,
          });
          const before = toDiscountJson(discountSettingsBefore);
          const after = toDiscountJson(savedSettings);

          if (JSON.stringify(before) !== JSON.stringify(after)) {
            await this.auditService.record(tx, {
              restaurantId: context.restaurantId,
              branchId,
              actorStaffUserId: context.staffUserId,
              actorRole: Role.ADMIN,
              action: 'BRANCH_DISCOUNT_SETTINGS_CHANGED',
              entityType: 'BranchSettings',
              entityId: branchId,
              before,
              after,
            });
          }
        }

        if (refundSettingsTouched) {
          const toJson = (
            value: {
              cashierRefundLimit: Prisma.Decimal | null;
              refundTipDefault: boolean;
            } | null,
          ) => ({
            cashierRefundLimit: value?.cashierRefundLimit?.toString() ?? null,
            refundTipDefault: value?.refundTipDefault ?? false,
          });
          const before = toJson(refundSettingsBefore);
          const after = toJson(savedSettings);

          if (JSON.stringify(before) !== JSON.stringify(after)) {
            await this.auditService.record(tx, {
              restaurantId: context.restaurantId,
              branchId,
              actorStaffUserId: context.staffUserId,
              actorRole: Role.ADMIN,
              action: 'BRANCH_REFUND_SETTINGS_CHANGED',
              entityType: 'BranchSettings',
              entityId: branchId,
              before,
              after,
            });
          }
        }
      }

      return tx.branch.findUniqueOrThrow({
        where: {
          id: branchId,
        },
        include: {
          settings: true,
        },
      });
    });

    return mapBranchToResponse(updatedBranch);
  }
}

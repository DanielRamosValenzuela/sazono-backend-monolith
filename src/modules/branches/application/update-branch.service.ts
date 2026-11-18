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
          },
        });

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

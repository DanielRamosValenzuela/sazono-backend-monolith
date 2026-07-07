import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type { JwtPayload } from '../../auth/interfaces/jwt-payload.interface';
import { BranchesStaffAccessService } from './branches-staff-access.service';
import { mapBranchToResponse } from './branch-mapper';
import type {
  BranchResponseDto,
  UpdateBranchDto,
} from '../presentation/http/dto/branch.dto';

@Injectable()
export class UpdateBranchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly branchesStaffAccessService: BranchesStaffAccessService,
  ) {}

  async execute(
    authUser: JwtPayload,
    branchId: string,
    dto: UpdateBranchDto,
  ): Promise<BranchResponseDto> {
    const context =
      await this.branchesStaffAccessService.getStaffContext(authUser);

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

        await tx.branchSettings.upsert({
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
          },
        });
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

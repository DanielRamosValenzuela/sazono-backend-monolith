import { ForbiddenException, Injectable } from '@nestjs/common';
import { BranchRoleStatus, Role, StaffUserStatus } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { LoginProfileType } from '../../auth/dto/login.dto';
import type { JwtPayload } from '../../auth/interfaces/jwt-payload.interface';
import type {
  CreateBranchDto,
  CreateBranchResponseDto,
} from '../presentation/http/dto/create-branch.dto';

@Injectable()
export class CreateBranchService {
  constructor(private readonly prisma: PrismaService) {}

  async execute(
    authUser: JwtPayload,
    dto: CreateBranchDto,
  ): Promise<CreateBranchResponseDto> {
    if (
      authUser.profileType !== LoginProfileType.STAFF ||
      !authUser.restaurantId
    ) {
      throw new ForbiddenException(
        'Solo un staff autenticado puede crear sucursales.',
      );
    }

    const staffUser = await this.prisma.staffUser.findFirst({
      where: {
        id: authUser.profileId,
        restaurantId: authUser.restaurantId,
        status: StaffUserStatus.ACTIVE,
      },
      include: {
        branchRoles: {
          where: {
            status: BranchRoleStatus.ACTIVE,
          },
          select: {
            role: true,
          },
        },
      },
    });

    if (!staffUser) {
      throw new ForbiddenException(
        'El perfil staff autenticado no esta disponible para este restaurante.',
      );
    }

    const canCreateBranch =
      staffUser.branchRoles.length === 0 ||
      staffUser.branchRoles.some(
        (branchRole) => branchRole.role === Role.ADMIN,
      );

    if (!canCreateBranch) {
      throw new ForbiddenException(
        'Solo un admin de sucursal puede crear nuevas sucursales.',
      );
    }

    const restaurant = await this.prisma.restaurant.findUniqueOrThrow({
      where: {
        id: staffUser.restaurantId,
      },
      select: {
        branchQuota: true,
        _count: {
          select: {
            branches: true,
          },
        },
      },
    });

    if (restaurant._count.branches >= restaurant.branchQuota) {
      throw new ForbiddenException(
        'Alcanzaste el limite de sucursales de tu plan. Contacta a Sazono para aumentarlo.',
      );
    }

    const branch = await this.prisma.$transaction(async (tx) => {
      const createdBranch = await tx.branch.create({
        data: {
          restaurantId: staffUser.restaurantId,
          name: dto.name,
          address: dto.address,
          settings: {
            create: {
              qrOrderingEnabled: dto.settings?.qrOrderingEnabled ?? true,
              qrPaymentMode: dto.settings?.qrPaymentMode ?? 'prepaid_order',
              splitBillEnabled: dto.settings?.splitBillEnabled ?? true,
              partialDeliveryEnabled:
                dto.settings?.partialDeliveryEnabled ?? true,
            },
          },
        },
        include: {
          settings: true,
        },
      });

      await tx.staffUserBranchRole.create({
        data: {
          staffUserId: staffUser.id,
          branchId: createdBranch.id,
          role: Role.ADMIN,
          status: BranchRoleStatus.ACTIVE,
        },
      });

      return createdBranch;
    });

    return {
      branchId: branch.id,
      restaurantId: branch.restaurantId,
      name: branch.name,
      address: branch.address,
      assignedRole: Role.ADMIN,
      settings: {
        qrOrderingEnabled: branch.settings?.qrOrderingEnabled ?? true,
        qrPaymentMode: branch.settings?.qrPaymentMode ?? 'prepaid_order',
        splitBillEnabled: branch.settings?.splitBillEnabled ?? true,
        partialDeliveryEnabled: branch.settings?.partialDeliveryEnabled ?? true,
      },
    };
  }
}

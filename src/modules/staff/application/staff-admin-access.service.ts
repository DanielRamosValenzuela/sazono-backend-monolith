import { ForbiddenException, Injectable } from '@nestjs/common';
import { BranchRoleStatus, Role, StaffUserStatus } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { LoginProfileType } from '../../auth/dto/login.dto';
import type { JwtPayload } from '../../auth/interfaces/jwt-payload.interface';

export type StaffAdminContext = {
  staffUserId: string;
  restaurantId: string;
  adminBranchIds: Set<string>;
};

@Injectable()
export class StaffAdminAccessService {
  constructor(private readonly prisma: PrismaService) {}

  async getAdminContext(authUser: JwtPayload): Promise<StaffAdminContext> {
    if (
      authUser.profileType !== LoginProfileType.STAFF ||
      !authUser.restaurantId
    ) {
      throw new ForbiddenException(
        'Solo un staff autenticado puede administrar usuarios internos.',
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
            branchId: true,
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

    const adminBranchIds = new Set(
      staffUser.branchRoles
        .filter((branchRole) => branchRole.role === Role.ADMIN)
        .map((branchRole) => branchRole.branchId),
    );

    if (adminBranchIds.size === 0) {
      throw new ForbiddenException(
        'Debes tener al menos un rol ADMIN para administrar usuarios internos.',
      );
    }

    return {
      staffUserId: staffUser.id,
      restaurantId: staffUser.restaurantId,
      adminBranchIds,
    };
  }
}

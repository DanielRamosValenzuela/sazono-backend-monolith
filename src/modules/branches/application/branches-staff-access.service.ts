import { ForbiddenException, Injectable } from '@nestjs/common';
import { BranchRoleStatus, Role, StaffUserStatus } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { LoginProfileType } from '../../auth/dto/login.dto';
import type { JwtPayload } from '../../auth/interfaces/jwt-payload.interface';

export type BranchesStaffContext = {
  staffUserId: string;
  restaurantId: string;
  memberBranchIds: Set<string>;
  adminBranchIds: Set<string>;
};

@Injectable()
export class BranchesStaffAccessService {
  constructor(private readonly prisma: PrismaService) {}

  async getStaffContext(authUser: JwtPayload): Promise<BranchesStaffContext> {
    if (
      authUser.profileType !== LoginProfileType.STAFF ||
      !authUser.restaurantId
    ) {
      throw new ForbiddenException(
        'Solo un staff autenticado puede consultar sucursales.',
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

    const memberBranchIds = new Set(
      staffUser.branchRoles.map((branchRole) => branchRole.branchId),
    );
    const adminBranchIds = new Set(
      staffUser.branchRoles
        .filter((branchRole) => branchRole.role === Role.ADMIN)
        .map((branchRole) => branchRole.branchId),
    );

    return {
      staffUserId: staffUser.id,
      restaurantId: staffUser.restaurantId,
      memberBranchIds,
      adminBranchIds,
    };
  }
}
